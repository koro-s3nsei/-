import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');

const REQUIRED_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
];

if (!fs.existsSync(manifestPath)) {
  console.error(`[patch-android-manifest] AndroidManifest.xml not found at: ${manifestPath}`);
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, 'utf8');
const injected = [];

for (const permission of REQUIRED_PERMISSIONS) {
  if (!xml.includes(permission)) {
    const tag = `    <uses-permission android:name="${permission}" />\n`;
    if (xml.includes('<application')) {
      xml = xml.replace('<application', `${tag}\n    <application`);
    } else if (xml.includes('</manifest>')) {
      xml = xml.replace('</manifest>', `${tag}</manifest>`);
    }
    injected.push(permission);
  }
}

fs.writeFileSync(manifestPath, xml, 'utf8');
console.log(
  `[patch-android-manifest] Complete. Injected ${injected.length} permissions (${
    injected.length > 0 ? injected.join(', ') : 'all already present'
  }).`
);
