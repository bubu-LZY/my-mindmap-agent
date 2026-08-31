Add-Type -AssemblyName System.Drawing

$outDir = "c:\Users\lizhuoyang\Desktop\新建文件夹\mind-map-ai-agent\electron\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$master = 1024
$scale = $master / 120.0
$bmp = New-Object System.Drawing.Bitmap($master, $master)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

function Fill-Circle([float]$cx, [float]$cy, [float]$r, [int]$alpha) {
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 0, 122, 255))
  $g.FillEllipse($brush, ($cx - $r) * $scale, ($cy - $r) * $scale, 2 * $r * $scale, 2 * $r * $scale)
  $brush.Dispose()
}

Fill-Circle 60 60 56 15
Fill-Circle 60 60 40 26
Fill-Circle 60 60 24 38

Fill-Circle 60 20 6 255
Fill-Circle 20 80 6 255
Fill-Circle 100 80 6 255

$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(102, 0, 122, 255), [float](2 * $scale))
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, [float](60 * $scale), [float](26 * $scale), [float](60 * $scale), [float](50 * $scale))
$g.DrawLine($pen, [float](26 * $scale), [float](76 * $scale), [float](48 * $scale), [float](60 * $scale))
$g.DrawLine($pen, [float](94 * $scale), [float](76 * $scale), [float](72 * $scale), [float](60 * $scale))
$pen.Dispose()
$g.Dispose()

$sizeList = @(256, 128, 64, 48, 32, 24, 16)
$pngMap = @{}
foreach ($sz in $sizeList) {
  $small = New-Object System.Drawing.Bitmap($sz, $sz)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sg.DrawImage($bmp, 0, 0, $sz, $sz)
  $sg.Dispose()
  $stream = New-Object System.IO.MemoryStream
  $small.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngMap[[int]$sz] = $stream.ToArray()
  $stream.Dispose()
  $small.Dispose()
}

Write-Host ("pngMap keys: " + ($pngMap.Keys -join ","))

[System.IO.File]::WriteAllBytes((Join-Path $outDir "icon.png"), $pngMap[[int]256])
[System.IO.File]::WriteAllBytes((Join-Path $outDir "tray-32.png"), $pngMap[[int]32])

$count = $sizeList.Count
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$count)
$offset = 6 + 16 * $count
foreach ($sz in $sizeList) {
  $data = $pngMap[[int]$sz]
  $wByte = 0
  if ($sz -lt 256) { $wByte = [byte]$sz }
  $bw.Write([byte]$wByte)
  $bw.Write([byte]$wByte)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($sz in $sizeList) {
  $bw.Write($pngMap[[int]$sz])
}
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir "icon.ico"), $out.ToArray())
$bw.Close()
$bmp.Dispose()

Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize
