# TILESANDBOX log fetcher: show failing steps of the latest runs and tail their logs.
# Pure ASCII only (PowerShell 5.1 decodes BOM-less ps1 as GBK).
param(
    [string]$Owner = 'king952701',
    [string]$Repo = 'tilesandbox',
    [int]$TailLines = 40
)

$ErrorActionPreference = 'Stop'
$token = $null
$srcDir = Join-Path $env:USERPROFILE 'Desktop\hunyuanji'
foreach ($n in @('_push_retry.ps1', '_gh_save.ps1', '_gh_craft.ps1', '_gh_bag.ps1', '_push_farm.ps1', '_push_api.ps1')) {
    $s = Join-Path $srcDir $n
    if (-not (Test-Path $s)) { continue }
    $txt = [System.IO.File]::ReadAllText($s, [System.Text.Encoding]::UTF8)
    $m = [regex]::Match($txt, 'ghp_[A-Za-z0-9]{20,}')
    if ($m.Success) { $token = $m.Value; break }
}
if (-not $token) { Write-Output 'NO_TOKEN'; exit 2 }

$headers = @{ 'Authorization' = "token $token"; 'User-Agent' = 'tilesandbox-logs'; 'Accept' = 'application/vnd.github+json' }
$base = "https://api.github.com/repos/$Owner/$Repo"

function Get-Redirect($url, $h) {
    $loc = $null
    try { $null = Invoke-WebRequest -Uri $url -Headers $h -MaximumRedirection 0 -ErrorAction Stop; return $url }
    catch { if ($_.Exception.Response -and $_.Exception.Response.Headers) { $loc = $_.Exception.Response.Headers['Location'] } }
    return $loc
}

$runs = Invoke-RestMethod -Method Get -Uri "$base/actions/runs?per_page=4" -Headers $headers
foreach ($r in $runs.workflow_runs) {
    Write-Output ('=== RUN ' + $r.id + ' ' + $r.name + ' ' + $r.conclusion + ' ===')
    $jobs = Invoke-RestMethod -Method Get -Uri "$base/actions/runs/$($r.id)/jobs" -Headers $headers
    foreach ($j in $jobs.jobs) {
        Write-Output (' JOB ' + $j.name + ' => ' + $j.conclusion)
        foreach ($s in $j.steps) {
            Write-Output ('   STEP[' + $s.number + '] ' + $s.name + ' => ' + $s.conclusion)
            if ($s.conclusion -eq 'failure') {
                $loc = Get-Redirect "$base/actions/jobs/$($j.id)/logs" $headers
                if ($loc) {
                    $tmp = Join-Path $env:TEMP ('tslog_' + $j.id + '.txt')
                    try { Invoke-WebRequest -Uri $loc -OutFile $tmp -ErrorAction Stop } catch { Write-Output ('   LOG DOWNLOAD FAILED ' + $_.Exception.Message) }
                    if (Test-Path $tmp) {
                        $lines = [System.IO.File]::ReadAllLines($tmp)
                        $start = [Math]::Max(0, $lines.Count - $TailLines)
                        for ($i = $start; $i -lt $lines.Count; $i++) { Write-Output ('   | ' + $lines[$i]) }
                        Remove-Item $tmp -Force
                    }
                }
            }
        }
    }
}
