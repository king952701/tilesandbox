# TILESANDBOX helper: enable Pages (workflow build) and print run diagnostics.
# Pure ASCII only (PowerShell 5.1 decodes BOM-less ps1 as GBK).
param(
    [string]$Owner = 'king952701',
    [string]$Repo = 'tilesandbox'
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
$headers = @{ 'Authorization' = "token $token"; 'User-Agent' = 'tilesandbox-fix'; 'Accept' = 'application/vnd.github+json' }
$base = "https://api.github.com/repos/$Owner/$Repo"

# 1. pages status
try {
    $pg = Invoke-RestMethod -Method Get -Uri "$base/pages" -Headers $headers
    Write-Output ('PAGES_STATUS ' + $pg.status + ' build_type=' + $pg.build_type)
} catch {
    Write-Output ('PAGES_NOT_ENABLED (' + $_.Exception.Message + ')')
    $body = @{ build_type = 'workflow'; source = @{ branch = 'main'; path = '/' } } | ConvertTo-Json -Depth 5
    try {
        $pg = Invoke-RestMethod -Method Put -Uri "$base/pages" -Headers $headers -Body $body -ContentType 'application/json'
        Write-Output ('PAGES_ENABLED ' + $pg.status)
    } catch {
        Write-Output ('PAGES_ENABLE_FAILED ' + $_.Exception.Message)
        try {
            $body2 = @{ source = @{ branch = 'main'; path = '/' } } | ConvertTo-Json -Depth 5
            $pg = Invoke-RestMethod -Method Post -Uri "$base/pages" -Headers $headers -Body $body2 -ContentType 'application/json'
            Write-Output ('PAGES_ENABLED_POST ' + $pg.status)
        } catch { Write-Output ('PAGES_POST_FAILED ' + $_.Exception.Message) }
    }
}

# 2. run diagnostics
$runs = Invoke-RestMethod -Method Get -Uri "$base/actions/runs?per_page=5" -Headers $headers
foreach ($r in $runs.workflow_runs) {
    Write-Output ('RUN ' + $r.id + ' | ' + $r.name + ' | status=' + $r.status + ' | conclusion=' + $r.conclusion + ' | event=' + $r.event + ' | title=' + $r.display_title)
    $jobs = Invoke-RestMethod -Method Get -Uri "$base/actions/runs/$($r.id)/jobs" -Headers $headers
    Write-Output ('  jobs=' + @($jobs.jobs).Count)
    foreach ($j in $jobs.jobs) {
        Write-Output ('  JOB ' + $j.name + ' | ' + $j.status + ' | ' + $j.conclusion)
        foreach ($s in $j.steps) {
            if ($s.conclusion -ne 'success' -and $s.conclusion -ne 'skipped') {
                Write-Output ('    STEP ' + $s.name + ' => ' + $s.conclusion)
            }
        }
    }
}

# 3. switch Pages to workflow build mode (deploy-pages@v4 requires it)
try {
    $body3 = @{ build_type = 'workflow' } | ConvertTo-Json
    $pg2 = Invoke-RestMethod -Method Put -Uri "$base/pages" -Headers $headers -Body $body3 -ContentType 'application/json'
    Write-Output ('PAGES_MODE build_type=' + $pg2.build_type + ' status=' + $pg2.status)
} catch { Write-Output ('PAGES_MODE_FAILED ' + $_.Exception.Message) }
try {
    $pg3 = Invoke-RestMethod -Method Get -Uri "$base/pages" -Headers $headers
    Write-Output ('PAGES_NOW build_type=' + $pg3.build_type + ' html_url=' + $pg3.html_url)
} catch { Write-Output 'PAGES_NOW unavailable' }

# 4. workflows known to GitHub
$wf = Invoke-RestMethod -Method Get -Uri "$base/actions/workflows" -Headers $headers
foreach ($w in $wf.workflows) { Write-Output ('WORKFLOW id=' + $w.id + ' name=' + $w.name + ' file=' + $w.path) }

# 5. re-trigger both workflows explicitly
foreach ($file in @('apk.yml', 'pages.yml')) {
    try {
        $null = Invoke-RestMethod -Method Post -Uri "$base/actions/workflows/$file/dispatches" -Headers $headers -Body (@{ ref = 'main' } | ConvertTo-Json) -ContentType 'application/json'
        Write-Output ('DISPATCHED ' + $file)
    } catch { Write-Output ('DISPATCH_FAILED ' + $file + ' : ' + $_.Exception.Message) }
    Start-Sleep -Seconds 1
}
