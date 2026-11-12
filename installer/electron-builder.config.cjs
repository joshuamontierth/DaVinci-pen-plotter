'use strict';

// Packaging for the desktop app (electron-builder, run from desktop/: npm run desktop:dist). Output goes to dist/:
//   Windows  davinci-<version>-win-x64-setup.exe  NSIS installer with the web server option (windows/installer.nsh)
//   Linux    davinci-<version>-linux-x64-setup.sh  installer: desktop app, web server or both (linux/install.sh)
//            davinci-<version>-linux-x86_64.AppImage and davinci_<version>_amd64.deb

const path = require('node:path');

const icons = path.join(__dirname, 'icons');

module.exports = {
  appId: 'com.joshuamontierth.davinci',
  productName: 'DaVinci',
  copyright: 'Copyright (c) 2026 joshuamontierth',
  asar: true,
  directories: {
    output: path.join(__dirname, '..', 'dist'),
    buildResources: __dirname,
  },
  files: ['main.js', 'preload.js', 'menu.js', 'server.js', 'bundle/**/*'],
  fileAssociations: [
    {
      ext: 'davinci',
      name: 'DaVinci project',
      description: 'DaVinci project',
      mimeType: 'application/x-davinci',
      role: 'Editor',
    },
  ],
  linux: {
    target: ['AppImage', 'deb'],
    icon: icons,
    category: 'Graphics',
    synopsis: 'Pen-plotter G-code generator',
    description: 'DaVinci turns text, drawings, images and patterns into pen-plotter G-code for Bambu Lab printers.',
    executableName: 'davinci',
    maintainer: 'joshuamontierth <joshuamontierth@gmail.com>',
    artifactName: 'davinci-${version}-linux-${arch}.${ext}',
  },
  deb: {
    packageName: 'davinci',
    artifactName: 'davinci_${version}_${arch}.${ext}',
    // the web server as a systemd user service, off until enabled (see the file)
    fpm: [`${path.join(__dirname, 'linux', 'davinci-server.service')}=/usr/lib/systemd/user/davinci-server.service`],
  },
  win: {
    target: ['nsis'],
    icon: path.join(icons, 'davinci.ico'),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    include: path.join(__dirname, 'windows', 'installer.nsh'),
    shortcutName: 'DaVinci',
    uninstallDisplayName: 'DaVinci',
    artifactName: 'davinci-${version}-win-${arch}-setup.${ext}',
  },
  afterAllArtifactBuild: path.join(__dirname, 'linux', 'make-installer.cjs'),
};
