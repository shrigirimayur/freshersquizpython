param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$OrganizerKey = $env:ORGANIZER_KEY
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OrganizerKey)) {
  throw 'Set ORGANIZER_KEY or pass -OrganizerKey before running this test.'
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$headers = @{ 'X-Organizer-Key' = $OrganizerKey }
$suffix = Get-Date -Format 'yyyyMMddHHmmss'
$name = "Smoke Student $suffix"
$participantId = "smoke-$suffix"

function Assert-Equal($Actual, $Expected, $Label) {
  if ($Actual -ne $Expected) { throw "$Label expected [$Expected], got [$Actual]" }
  Write-Host "PASS  $Label = $Actual" -ForegroundColor Green
}

function Assert-True($Value, $Label) {
  if (-not $Value) { throw "$Label expected true" }
  Write-Host "PASS  $Label" -ForegroundColor Green
}

Write-Host "Testing $BaseUrl" -ForegroundColor Cyan
$page = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/" -TimeoutSec 45
Assert-Equal $page.StatusCode 200 'Participant page'
$organizerPage = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/organizer.html" -TimeoutSec 45
Assert-Equal $organizerPage.StatusCode 200 'Organizer page'

$studentBody = @{ participantName = $name; participantId = $participantId; tabId = 'smoke-tab-1' } | ConvertTo-Json
$login = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$BaseUrl/api/session/register" -ContentType 'application/json' -Body $studentBody -TimeoutSec 45 | Select-Object -ExpandProperty Content | ConvertFrom-Json
Assert-Equal $login.state 'waiting' 'Participant waiting state'

$duplicateBody = @{ participantName = $name.ToUpper(); participantId = "$participantId-duplicate"; tabId = 'smoke-tab-2' } | ConvertTo-Json
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$BaseUrl/api/session/register" -ContentType 'application/json' -Body $duplicateBody -TimeoutSec 45 | Out-Null
  throw 'Duplicate participant name was accepted'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
  Write-Host 'PASS  Duplicate participant name rejected = 409' -ForegroundColor Green
}

$state = Invoke-RestMethod -Uri "$BaseUrl/api/state" -Headers $headers -TimeoutSec 45
if ($state.PSObject.Properties.Name -notcontains 'sessions') {
  throw 'Organizer authorization failed. Set OrganizerKey to the exact Render ORGANIZER_KEY value.'
}
$online = @($state.sessions | Where-Object participantName -eq $name)[0].connected
Assert-True $online 'Organizer sees participant online'

$startBody = @{ selectedParticipantIds = @($name); durationMinutes = 10 } | ConvertTo-Json
$started = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/organizer/start" -Headers $headers -ContentType 'application/json' -Body $startBody -TimeoutSec 45
Assert-Equal $started.competition.state 'running' 'Competition state after start'
Assert-True ($null -ne $started.competition.endsAt) 'Server end time exists'

$stateBody = @{ participantId = $login.participantId; sessionId = $login.sessionId; tabId = 'smoke-tab-1' } | ConvertTo-Json
$participantState = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/session/state" -ContentType 'application/json' -Body $stateBody -TimeoutSec 45
Assert-Equal $participantState.session.state 'quiz' 'Selected participant quiz state'

$wrongTabBody = @{ participantId = $login.participantId; sessionId = $login.sessionId; tabId = 'wrong-tab'; questionId = 1; optionIndex = 0 } | ConvertTo-Json
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$BaseUrl/api/session/answer" -ContentType 'application/json' -Body $wrongTabBody -TimeoutSec 45 | Out-Null
  throw 'Unauthorized tab answer was accepted'
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw }
  Write-Host 'PASS  Unauthorized tab answer rejected = 403' -ForegroundColor Green
}

$answerBody = @{ participantId = $login.participantId; sessionId = $login.sessionId; tabId = 'smoke-tab-1'; questionId = 1; optionIndex = 0 } | ConvertTo-Json
$answer = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/session/answer" -ContentType 'application/json' -Body $answerBody -TimeoutSec 45
Assert-Equal $answer.answers.PSObject.Properties.Count 1 'Submitted answer count'

$submitted = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/session/submit" -ContentType 'application/json' -Body $stateBody -TimeoutSec 45
Assert-Equal $submitted.state 'submitted' 'Server-side final submission'

Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/organizer/stop" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45 | Out-Null
$stopped = Invoke-RestMethod -Uri "$BaseUrl/api/state" -Headers $headers -TimeoutSec 45
Assert-Equal $stopped.competition.state 'stopped' 'Competition state after stop'

$beforeReveal = $stopped.questions[0].PSObject.Properties.Name -notcontains 'correct'
Assert-True $beforeReveal 'Answer key hidden before reveal'
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/organizer/reveal-answers" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 45 | Out-Null
$afterReveal = Invoke-RestMethod -Uri "$BaseUrl/api/state" -Headers $headers -TimeoutSec 45
Assert-True ($afterReveal.questions[0].PSObject.Properties.Name -contains 'correct') 'Answer key visible after reveal'

Write-Host "PASS  Full smoke test completed for $name" -ForegroundColor Green
