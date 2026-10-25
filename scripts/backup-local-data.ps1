param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceDirectory = (Resolve-Path -LiteralPath (Join-Path $repoRoot '.data')).Path

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path (Split-Path -Parent $repoRoot) 'backups'
}

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archivePath = Join-Path $outputPath "yewen-local-data-$timestamp.zip"
$stageDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "yewen-backup-$([guid]::NewGuid().ToString('N'))"

try {
  [System.IO.Directory]::CreateDirectory($stageDirectory) | Out-Null

  foreach ($fileName in @('users.json', 'admin.json')) {
    $sourceFile = Join-Path $sourceDirectory $fileName
    if (Test-Path -LiteralPath $sourceFile) {
      Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $stageDirectory $fileName)
    }
  }

  $userDataDirectory = Join-Path $sourceDirectory 'users'
  if (Test-Path -LiteralPath $userDataDirectory) {
    Copy-Item -LiteralPath $userDataDirectory -Destination (Join-Path $stageDirectory 'users') -Recurse
  }

  $usersFile = Join-Path $sourceDirectory 'users.json'
  $userCount = 0
  if (Test-Path -LiteralPath $usersFile) {
    $usersJson = [System.IO.File]::ReadAllText($usersFile, [System.Text.Encoding]::UTF8)
    $registry = $usersJson | ConvertFrom-Json
    $userCount = @($registry.users).Count
  }

  $manifest = [ordered]@{
    product = '业问'
    createdAt = (Get-Date).ToString('o')
    userCount = $userCount
    schemaVersion = 1
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stageDirectory 'backup-manifest.json') -Encoding UTF8

  if (Test-Path -LiteralPath $archivePath) {
    throw "Backup file already exists: $archivePath"
  }
  Compress-Archive -Path (Join-Path $stageDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal

  $archive = Get-Item -LiteralPath $archivePath
  [pscustomobject]@{
    Archive = $archive.FullName
    SizeBytes = $archive.Length
    UserCount = $userCount
    ExcludesSessions = $true
    ExcludesApiConfig = $true
  } | ConvertTo-Json
} finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stageDirectory)
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedStage.StartsWith($tempRoot) -and (Test-Path -LiteralPath $resolvedStage)) {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}
