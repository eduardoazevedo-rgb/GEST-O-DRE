# Registra as tarefas de sincronização no Agendador de Tarefas do Windows.
# Rode uma vez, como Administrador:  powershell -ExecutionPolicy Bypass -File scripts\agendar-tarefas.ps1
$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }
$dir     = "C:\Users\Administrator\Documents\GESTAO-DRE"
$scripts = Join-Path $dir "scripts"

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

function Registrar($nome, $argumento, $trigger) {
  $action = New-ScheduledTaskAction -Execute $node -Argument $argumento -WorkingDirectory $dir
  Register-ScheduledTask -TaskName $nome -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "  OK: $nome"
}

# 1) Vigia da fila (botão "Atualizar agora") — a cada 1 minuto
$tWorker = New-ScheduledTaskTrigger -Once -At (Get-Date)
$tWorker.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)).Repetition
Registrar "GestaoDRE - Worker (fila)" "$scripts\sync-worker.mjs" $tWorker

# 2) Incremental automático — 06:00 e 14:00
Registrar "GestaoDRE - Incremental 06h" "$scripts\sync-cli.mjs incremental" (New-ScheduledTaskTrigger -Daily -At 6:00am)
Registrar "GestaoDRE - Incremental 14h" "$scripts\sync-cli.mjs incremental" (New-ScheduledTaskTrigger -Daily -At 2:00pm)

# 3) Rede de segurança — full do ano corrente, domingo 03:00
Registrar "GestaoDRE - Full ano (semanal)" "$scripts\sync-cli.mjs full_ano" (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3:00am)

Write-Host "`nTarefas registradas. Veja em: Get-ScheduledTask -TaskName 'GestaoDRE*'"
