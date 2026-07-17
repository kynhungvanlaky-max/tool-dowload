const fs = require('fs');
const mf = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

console.log('=== MV3 Compatibility Check ===\n');

// 1. web_accessible_resources format
if (Array.isArray(mf.web_accessible_resources) && mf.web_accessible_resources.length === 0) {
  console.log('[WARN] web_accessible_resources la empty array');
  console.log('       Chrome MV3 yeu cau format: [{resources:[...], matches:[...]}]');
  console.log('       Neu khong dung toi: nen XOA han field nay\n');
} else {
  console.log('[OK] web_accessible_resources:', JSON.stringify(mf.web_accessible_resources));
}

// 2. content_scripts
if (mf.content_scripts) {
  mf.content_scripts.forEach((cs, i) => {
    console.log('[INFO] content_script[' + i + '] matches:', JSON.stringify(cs.matches));
    cs.js && cs.js.forEach(f => {
      const ok = fs.existsSync(f);
      console.log('  [' + (ok ? 'OK' : 'MISSING') + '] js: ' + f);
    });
    cs.css && cs.css.forEach(f => {
      const ok = fs.existsSync(f);
      console.log('  [' + (ok ? 'OK' : 'MISSING') + '] css: ' + f);
    });
  });
}

// 3. Popup HTML kiem tra CSS va JS references
const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
console.log('\n[INFO] Popup references:');

// CSS
const cssRefs = [...popupHtml.matchAll(/href="([^"]+\.css)"/g)].map(m => m[1]);
cssRefs.forEach(f => {
  const fullPath = 'popup/' + f;
  const ok = fs.existsSync(fullPath);
  console.log('  [' + (ok ? 'OK' : 'MISSING') + '] CSS: ' + f + ' -> ' + fullPath);
});

// JS
const jsRefs = [...popupHtml.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
jsRefs.forEach(f => {
  const fullPath = 'popup/' + f;
  const ok = fs.existsSync(fullPath);
  console.log('  [' + (ok ? 'OK' : 'MISSING') + '] JS: ' + f + ' -> ' + fullPath);
});

// 4. Kiem tra tong the cau truc thu muc
console.log('\n[INFO] Thu muc extension:');
function listDir(dir, indent) {
  try {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const full = dir + '/' + item;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        console.log(indent + '[DIR] ' + item + '/');
        listDir(full, indent + '  ');
      } else {
        console.log(indent + '  ' + item + ' (' + stat.size + ' bytes)');
      }
    });
  } catch(e) {}
}
listDir('d:/Tooldowload/extension', '');
