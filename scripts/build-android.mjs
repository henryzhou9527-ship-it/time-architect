/**
 * One-command Android APK build:
 *
 *   npm run android:apk
 *   TA_API_BASE=https://my-deploy.example npm run android:apk
 *
 * Steps: build www/ bundle → cap sync android → gradle assembleDebug →
 * copy the APK to ./TimeArchitect-debug.apk.
 *
 * Requires the Android SDK (android/local.properties or ANDROID_HOME) and a
 * JDK 21 — Android Studio's bundled "jbr" is auto-detected on Windows.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, opts = {}) {
    console.log(`\n> ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function findJavaHome() {
    if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
    const candidates = [
        'C:/Program Files/Android/Android Studio/jbr',
        'C:/Program Files/Android/Android Studio/jre',
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
    ];
    for (const dir of candidates) {
        if (fs.existsSync(dir)) return dir;
    }
    return '';
}

// 1. web bundle (sets the cloud API base for account interop)
run('node scripts/build-www.mjs');

// 2. ensure SDK location for gradle
const localProps = path.join(ROOT, 'android', 'local.properties');
if (!fs.existsSync(localProps)) {
    const sdk = process.env.ANDROID_HOME
        || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
    fs.writeFileSync(localProps, `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
    console.log(`wrote android/local.properties (sdk.dir=${sdk})`);
}

// 3. sync web assets + plugins into the android project
run('npx cap sync android');

// 4. gradle build
const javaHome = findJavaHome();
if (!javaHome) {
    console.error('No JDK found. Install Android Studio or set JAVA_HOME to a JDK 21.');
    process.exit(1);
}
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(`${gradlew} assembleDebug --console=plain`, {
    cwd: path.join(ROOT, 'android'),
    env: { ...process.env, JAVA_HOME: javaHome }
});

// 5. surface the artifact
const apk = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const out = path.join(ROOT, 'TimeArchitect-debug.apk');
fs.copyFileSync(apk, out);
const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\nAPK ready: TimeArchitect-debug.apk (${size} MB)`);
console.log('Install: adb install -r TimeArchitect-debug.apk  (or send the file to the phone)');
