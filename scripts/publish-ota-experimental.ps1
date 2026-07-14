# Publish a rolling EXPERIMENTAL OTA prerelease.
# Builds the experimental OTA assets and (re)uploads them to the fixed
# "experimental" prerelease. Does NOT bump the version and does NOT git push.
$ErrorActionPreference = "Stop"

$repo = "fabiorenner-hub/hmip-hcu-fritzbox-presence"
$dir = "release/experimental"

node scripts/build-ota.mjs experimental

# Ensure the rolling prerelease exists.
$exists = gh release view experimental -R $repo 2>$null
if (-not $exists) {
  gh release create experimental -R $repo --prerelease --title "experimental" `
    --notes "Rolling experimental OTA channel. For testing only."
}

# Upload/replace the experimental assets.
gh release upload experimental -R $repo `
  "$dir/fritzboxpresence-ota-exp.json" `
  "$dir/ota-manifest-exp.json" `
  "$dir/fritzboxpresence-ota-exp.json.sha256" `
  --clobber

Write-Output "Experimental OTA published to release 'experimental'."
