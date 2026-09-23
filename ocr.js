// 写真からタスク候補を読み取る（Tesseract.js を使ってブラウザ内で文字認識）
(() => {
  'use strict';

  const TESSERACT_VERSION = '5.1.1';
  const CDN = 'https://cdn.jsdelivr.net/npm';
  const SCRIPT_URL = `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
  const WORKER_OPTIONS = {
    workerPath: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
    corePath: `${CDN}/tesseract.js-core@${TESSERACT_VERSION}`,
    langPath: `${CDN}/@tesseract.js-data/jpn/4.0.0_best_int`,
  };

  const STATUS_LABEL = {
    'loading tesseract core': '認識エンジンを準備中',
    'initializing tesseract': '認識エンジンを準備中',
    'loading language traineddata': '日本語データを読み込み中（初回のみ時間がかかります）',
    'initializing api': '認識エンジンを準備中',
    'recognizing text': '文字を読み取り中',
  };

  let scriptPromise = null;
  let workerPromise = null;

  function loadScript() {
    if (window.Tesseract) return Promise.resolve();
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SCRIPT_URL;
        s.onload = resolve;
        s.onerror = () => {
          scriptPromise = null;
          reject(new Error('文字認識ライブラリを読み込めませんでした。ネットワーク接続を確認してください。'));
        };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  let onProgress = () => {};

  async function getWorker() {
    await loadScript();
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker('jpn', 1, {
        ...WORKER_OPTIONS,
        logger: (m) => onProgress(STATUS_LABEL[m.status] || '準備中', m.progress || 0),
      }).catch((e) => {
        workerPromise = null;
        throw e;
      });
    }
    return workerPromise;
  }

  // 大きな写真は縮小してから認識する（スマホ写真はそのままだと重い）
  function downscale(file, maxSize = 2000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした。'));
      };
      img.src = url;
    });
  }

  async function recognize(file, progress) {
    onProgress = progress || (() => {});
    const worker = await getWorker();
    const image = await downscale(file);
    const { data } = await worker.recognize(image);
    return data.text;
  }

  // ---- テキスト → タスク候補 ----

  const CJK = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';
  const BULLET = /^\s*(?:[・•●○◯◎■□☐☑✓✔\-*+>〇]|\d{1,2}[.)．、]|[①-⑳]|\(\d{1,2}\))\s*/;

  function normalizeLine(line) {
    return line
      // OCR が日本語の文字間に入れる空白を除去
      .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g'), '$1')
      .replace(new RegExp(`([${CJK}])\\s+(?=[0-9０-９])|([0-9０-９])\\s+(?=[${CJK}])`, 'g'), '$1$2')
      // 全角英数字・記号を半角に
      .replace(/[０-９Ａ-Ｚａ-ｚ／：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // 「9/30」「9月30日」「2026/9/30」などを YYYY-MM-DD に。年がなければ今日以降の直近の日付とみなす
  function extractDue(text, today = new Date()) {
    const re = /(?:(\d{4})\s*[/年.-]\s*)?(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?(?:\s*\([^)]*\))?/;
    const m = text.match(re);
    if (!m) return { title: text, due: null };

    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { title: text, due: null };

    let year = m[1] ? Number(m[1]) : today.getFullYear();
    if (!m[1]) {
      const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      if (`${year}-${pad(month)}-${pad(day)}` < todayStr) year += 1;
    }

    const title = text
      .replace(m[0], ' ')
      .replace(/(?:期限|〆切?|締切|締め切り|まで|〆|迄)\s*[:：]?\s*(?=\s|$)/g, ' ')
      .replace(/[（(]\s*[)）]|[【［\[]\s*[】］\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:：、,-]+|[\s:：、,-]+$/g, '');

    return { title: title || text, due: `${year}-${pad(month)}-${pad(day)}` };
  }

  function parseTasks(text, today = new Date()) {
    const seen = new Set();
    const result = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = normalizeLine(raw).replace(BULLET, '').trim();
      // 記号だけの行や 1 文字だけの行は読み取りミスとみなして捨てる
      if ([...line.replace(/[^\p{L}\p{N}]/gu, '')].length < 2) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      result.push(extractDue(line, today));
    }
    return result;
  }

  window.TaskOCR = { recognize, parseTasks };
})();
