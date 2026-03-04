'use strict'

const fs = require('fs')
const path = require('path')

function shouldKeepLocale(name, keepPrefixes) {
  return keepPrefixes.some((prefix) => name.startsWith(prefix))
}

function pruneLocaleFiles(localeDir, keepPrefixes) {
  if (!fs.existsSync(localeDir)) {
    return
  }

  const files = fs.readdirSync(localeDir)
  for (const fileName of files) {
    if (!shouldKeepLocale(fileName, keepPrefixes)) {
      fs.unlinkSync(path.join(localeDir, fileName))
    }
  }
}

function pruneLprojDirs(resourcesDir, keepPrefixes) {
  if (!fs.existsSync(resourcesDir)) {
    return
  }

  const entries = fs.readdirSync(resourcesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.lproj')) {
      continue
    }

    const localeName = entry.name.slice(0, -'.lproj'.length)
    if (!shouldKeepLocale(localeName, keepPrefixes)) {
      fs.rmSync(path.join(resourcesDir, entry.name), { recursive: true, force: true })
    }
  }
}

function getLocaleRoots(appOutDir) {
  const roots = [appOutDir]

  if (!fs.existsSync(appOutDir)) {
    return roots
  }

  const entries = fs.readdirSync(appOutDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      roots.push(path.join(appOutDir, entry.name))
    }
  }

  return roots
}

exports.default = async function removeLocales(context) {
  const keepPrefixes = ['en', 'zh']

  const roots = getLocaleRoots(context.appOutDir)
  for (const rootDir of roots) {
    const localeDirs = [
      path.join(rootDir, 'locales'),
      path.join(rootDir, 'Contents', 'Resources', 'locales'),
      path.join(
        rootDir,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources',
        'locales'
      )
    ]

    for (const localeDir of localeDirs) {
      pruneLocaleFiles(localeDir, keepPrefixes)
    }

    const lprojResourceDirs = [
      path.join(rootDir, 'Contents', 'Resources'),
      path.join(
        rootDir,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources'
      )
    ]

    for (const resourcesDir of lprojResourceDirs) {
      pruneLprojDirs(resourcesDir, keepPrefixes)
    }
  }
}
