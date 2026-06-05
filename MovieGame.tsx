export function isTamilText(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text);
}

export function convertTamilishToTamil(input: string): string {
  if (!input) return "";
  if (isTamilText(input)) return input;

  const lower = input.toLowerCase().trim();
  const tokens = lower.split(/(\s+)/);

  const independentVowel: Record<string, string> = {
    a: 'அ', aa: 'ஆ', i: 'இ', ii: 'ஈ', u: 'உ', uu: 'ஊ', e: 'எ', ee: 'ஏ', ai: 'ஐ', o: 'ஒ', oo: 'ஓ', au: 'ஔ'
  };

  const consonantMap: Record<string, string> = {
    ng: 'ங', nj: 'ஞ', ny: 'ஞ', nn: 'ண', ch: 'ச', sh: 'ஷ', zh: 'ழ', j: 'ஜ', c: 'ச', k: 'க', kh: 'க', g: 'க', gh: 'க', q: 'க', x: 'க', t: 'ட', th: 'த', d: 'ட', dh: 'த', p: 'ப', ph: 'ப', b: 'ப', m: 'ம', y: 'ய', r: 'ர', rr: 'ற', l: 'ல', ll: 'ள', v: 'வ', w: 'வ', h: 'ஹ', f: 'ஃ', n: 'ந'
  };

  const vowelSignMap: Record<string, string> = {
    a: '', aa: 'ா', i: 'ி', ii: 'ீ', u: 'ு', uu: 'ூ', e: 'ெ', ee: 'ே', ai: 'ை', o: 'ொ', oo: 'ோ', au: 'ௌ'
  };

  const vowelKeys = ['au', 'aa', 'ii', 'ee', 'oo', 'ai', 'a', 'i', 'u', 'e', 'o'];
  const consonantKeys = [
    'ng', 'nj', 'ny', 'ch', 'sh', 'zh', 'kh', 'gh', 'ph', 'th', 'dh', 'rr', 'll', 'nn',
    'k', 'g', 'c', 'j', 't', 'd', 'n', 'p', 'b', 'm', 'y', 'r', 'l', 'v', 'w', 'h', 'f', 'z', 's'
  ];

  return tokens.map(token => {
    if (/^\s*$/.test(token)) return token;
    let result = '';
    let i = 0;

    while (i < token.length) {
      const chunk = token.slice(i);

      let vow = '';
      for (const key of vowelKeys) {
        if (chunk.startsWith(key)) { vow = key; break; }
      }

      let cons = '';
      for (const key of consonantKeys) {
        if (chunk.startsWith(key)) { cons = key; break; }
      }

      if (!cons && chunk[0] && consonantMap[chunk[0]]) {
        cons = chunk[0];
      }

      // Consonant + vowel combinatorics
      if (cons && chunk.startsWith(cons)) {
        const base = consonantMap[cons] || '';
        const remainder = chunk.slice(cons.length);
        let matchedVow = '';

        for (const key of vowelKeys) {
          if (remainder.startsWith(key)) {
            matchedVow = key;
            break;
          }
        }

        if (matchedVow === 'a') {
          result += base;
          i += cons.length + 1;
        } else if (matchedVow && vowelSignMap[matchedVow] !== undefined) {
          result += base + vowelSignMap[matchedVow];
          i += cons.length + matchedVow.length;
        } else {
          result += base + '்';
          i += cons.length;
        }
      }
      // Independent vowels
      else if (vow && independentVowel[vow]) {
        result += independentVowel[vow];
        i += vow.length;
      }
      // Fallback
      else {
        result += chunk[0] || '';
        i += 1;
      }
    }

    return result;
  }).join('');
}

export function getLetterCountExact(str: string): number {
  if (!str) return 0;
  
  // Try using Intl.Segmenter
  try {
    const segmenter = new Intl.Segmenter('ta-IN', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(str)).map(s => s.segment);
    return segments.filter(c => c.trim() !== '').length;
  } catch (e) {
    // Regexp fallback for old environments or Node execution without Intl Support
    const segments = str.match(/[\u0B80-\u0BFF][\u0BBE-\u0BCC\u0BCD\u0BD7]*/g) || [];
    return segments.filter(c => c.trim() !== '').length;
  }
}

export function getSegments(str: string): string[] {
  if (!str) return [];
  try {
    const segmenter = new Intl.Segmenter('ta-IN', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(str)).map(s => s.segment);
  } catch (e) {
    return str.match(/[\u0B80-\u0BFF][\u0BBE-\u0BCC\u0BCD\u0BD7]*|\s+/g) || Array.from(str);
  }
}
