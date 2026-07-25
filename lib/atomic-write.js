const fs = require('fs')
const fsp = fs.promises

/** Write JSON to filePath via write-to-temp-then-rename, so readers never see a partial file. */
async function atomicWriteJSON (filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmpPath, filePath)
}

module.exports = { atomicWriteJSON }
