import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";

interface VinculosBody {
  restringe_empresas?: boolean;
  restringe_contas?: boolean;
  filiais?: number[];
  contas?: { empresa_id: number; codigo: string }[];
}

/** Lê os modos de restrição e os vínculos (unidades e contas) de um usuário (só admin). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const admin = createAdminClient();
  const [{ data: perfil, error: e0 }, { data: filiais, error: e1 }, { data: contas, error: e2 }] = await Promise.all([
    admin.from("profiles").select("restringe_empresas, restringe_contas").eq("id", id).single(),
    admin.from("usuario_filiais").select("cd_empresa").eq("user_id", id),
    admin.from("usuario_contas").select("empresa_id, codigo").eq("user_id", id),
  ]);
  if (e0 || e1 || e2) return NextResponse.json({ error: (e0 ?? e1 ?? e2)!.message }, { status: 400 });

  return NextResponse.json({
    restringe_empresas: perfil?.restringe_empresas ?? true,
    restringe_contas: perfil?.restringe_contas ?? true,
    filiais: (filiais ?? []).map((f) => f.cd_empresa),
    contas: contas ?? [],
  });
}

/** Substitui os modos de restrição e os vínculos do usuário (só admin). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as VinculosBody;

  const restringeEmpresas = body.restringe_empresas !== false;
  const restringeContas = body.restringe_contas !== false;
  const filiais = [...new Set((body.filiais ?? []).filter((f) => Number.isInteger(f)))];
  const contasBrutas = (body.contas ?? []).filter(
    (c) => c && Number.isInteger(c.empresa_id) && typeof c.codigo === "string" && /^\d+(\.\d+)*$/.test(c.codigo)
  );
  const contas = [...new Map(contasBrutas.map((c) => [`${c.empresa_id}|${c.codigo}`, c])).values()];

  const admin = createAdminClient();

  // Empresas derivadas dos vínculos: unidades escolhidas e contas escolhidas.
  // (plano/orçamento não têm dimensão de unidade — o acesso à empresa vem daí)
  const empresas = new Set<number>(contas.map((c) => c.empresa_id));
  if (filiais.length > 0) {
    const { data: fs, error } = await admin.from("filiais").select("cd_empresa, empresa_id").in("cd_empresa", filiais);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const validas = new Set((fs ?? []).map((f) => f.cd_empresa));
    const invalidas = filiais.filter((f) => !validas.has(f));
    if (invalidas.length > 0) {
      return NextResponse.json({ error: `Unidade(s) inexistente(s): ${invalidas.join(", ")}` }, { status: 400 });
    }
    for (const f of fs ?? []) empresas.add(f.empresa_id);
  }

  const { error: ePerfil } = await admin
    .from("profiles")
    .update({ restringe_empresas: restringeEmpresas, restringe_contas: restringeContas })
    .eq("id", id);
  if (ePerfil) return NextResponse.json({ error: ePerfil.message }, { status: 400 });

  for (const tabela of ["usuario_filiais", "usuario_contas", "usuario_empresas"] as const) {
    const { error } = await admin.from(tabela).delete().eq("user_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (filiais.length > 0) {
    const { error } = await admin
      .from("usuario_filiais")
      .insert(filiais.map((cd_empresa) => ({ user_id: id, cd_empresa })));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (contas.length > 0) {
    const { error } = await admin
      .from("usuario_contas")
      .insert(contas.map((c) => ({ user_id: id, empresa_id: c.empresa_id, codigo: c.codigo })));
    if (error) {
      const msg = error.message.includes("foreign key")
        ? "Uma das contas enviadas não existe no plano de contas"
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }
  // Sem unidade marcada, o acesso à empresa (plano/orçamento) vem do vínculo
  // empresa-wide derivado das contas; com unidades, elas mesmas dão o acesso.
  if (empresas.size > 0 && filiais.length === 0) {
    const { error } = await admin
      .from("usuario_empresas")
      .insert([...empresas].map((empresa_id) => ({ user_id: id, empresa_id })));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, filiais: filiais.length, contas: contas.length });
}
