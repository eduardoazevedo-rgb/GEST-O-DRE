"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, LabelList,
} from "recharts";
import { formatNumero } from "@/lib/labels";
import type { PassoPonte } from "@/lib/executivo";

const VERDE = "#059669";
const VERMELHO = "#dc2626";
const AZUL = "#0000C2";

interface Props {
  passos: PassoPonte[];
}

export default function PonteResultado({ passos }: Props) {
  // Cada barra tem uma parte "base" invisível e a parte visível (valor/altura).
  const data = passos.map((p) => ({
    rotulo: p.rotulo,
    base: p.base,
    valor: p.tipo === "total" ? p.valor : Math.abs(p.valor),
    sinal: p.valor,
    tipo: p.tipo,
    favoravel: p.favoravel,
  }));

  const cor = (p: (typeof data)[number]) =>
    p.tipo === "total" ? AZUL : p.favoravel ? VERDE : VERMELHO;

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 8 }} barCategoryGap="18%">
          <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} width={90} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            formatter={(_v, _n, item) => {
              const d = item.payload as (typeof data)[number];
              const valor = d.tipo === "total" ? d.sinal : d.sinal;
              return [formatNumero(valor), d.tipo === "total" ? "Total" : "Variação"];
            }}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          {/* base invisível empilhada */}
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          {/* parte visível */}
          <Bar dataKey="valor" stackId="a" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={cor(d)} />
            ))}
            <LabelList
              dataKey="sinal"
              position="top"
              formatter={(v) => {
                const n = Number(v);
                return n >= 0 ? `+${formatNumero(n)}` : formatNumero(n);
              }}
              style={{ fontSize: 10, fill: "var(--text-muted)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
