# Remove leftover old commonToolsPrompt body from toolHandler.js
$p = Join-Path $PSScriptRoot "..\src\services\toolHandler.js"
$c = [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false))

# short version of the get_mindmap_content line only exists in the old leftover block
$marker = "- get_mindmap_content: " + [char]0x83B7 + [char]0x53D6 + [char]0x5F53 + [char]0x524D + [char]0x5BFC + [char]0x56FE + [char]0x5185 + [char]0x5BB9
$first = $c.IndexOf($marker)
$second = $c.IndexOf($marker, $first + 1)
if ($second -lt 0) { Write-Host "LEFTOVER NOT FOUND (first=$first)"; exit 1 }

$lineStart = $c.LastIndexOf("`n", $second) + 1
# terminating backtick: last backtick+newline in file
$tail = $c.LastIndexOf("``")
if ($tail -lt $lineStart) { Write-Host "TAIL NOT FOUND"; exit 1 }
# extend to end of that line (past \r\n if present)
$tailEnd = $tail + 1
if ($tailEnd -lt $c.Length -and $c[$tailEnd] -eq "`r") { $tailEnd++ }
if ($tailEnd -lt $c.Length -and $c[$tailEnd] -eq "`n") { $tailEnd++ }

Write-Host ("Removing [{0}, {1}) of {2}" -f $lineStart, $tailEnd, $c.Length)
$new = $c.Substring(0, $lineStart).TrimEnd("`r", "`n") + "`r`n" + $c.Substring([Math]::Min($tailEnd, $c.Length)).TrimStart("`r", "`n")
[IO.File]::WriteAllText($p, $new, [Text.UTF8Encoding]::new($false))
Write-Host "DONE. New length: $($new.Length)"
