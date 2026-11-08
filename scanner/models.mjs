import fs from 'node:fs';
import path from 'node:path';
import { norm, slug, uniq, listDir } from './util.mjs';

// Su Windows Hugging Face puo' tenere i file in un magazzino condiviso (hub\blobs): nella cartella
// del modello restano solo collegamenti. Il peso si calcola quindi seguendo i collegamenti.
function hfSize(dir, fallback) {
  const blobs = path.join(dir, 'blobs');
  const entries = listDir(blobs);
  if (!entries.length) return fallback;
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith('.incomplete')) continue;
    try { total += fs.statSync(path.join(blobs, e.name)).size; } catch {}
  }
  return total;
}

// Regole per riconoscere i modelli noti. L'ordine conta: vince la prima che corrisponde.
// Quello che non corrisponde a nessuna regola compare comunque, col nome del file.
const RULES = [
  [/qwen[-_ ]?image[-_ ]?2\.?1/, 'Qwen-Image 2.1', 'Immagini'],
  [/ltx[-_ ]?2\.?5/, 'LTX-2.5', 'Video'],
  [/ace[-_]?step|ace[-_]1\.5|_ace15/, 'ACE-Step 1.5', 'Musica'],
  [/qwen3?[-_ ]?tts[-_.\w]*voicedesign/, 'Qwen3-TTS VoiceDesign', 'Voce'],
  [/qwen3?[-_ ]?tts/, 'Qwen3-TTS', 'Voce'],
  [/chatterbox/, 'Chatterbox', 'Voce'],
  [/voxcpm/, 'VoxCPM2', 'Voce'],
  [/omnivoice/, 'OmniVoice', 'Voce'],
  [/kokoro/, 'Kokoro', 'Voce'],
  [/faster[-_]whisper[-_]large[-_]v3[-_]turbo/, 'Whisper large-v3-turbo', 'Trascrizione'],
  [/faster[-_]whisper[-_]large[-_]v3/, 'Whisper large-v3', 'Trascrizione'],
  [/faster[-_]whisper[-_]small/, 'Whisper small', 'Trascrizione'],
  [/faster[-_]whisper[-_]base/, 'Whisper base', 'Trascrizione'],
  [/sherpa-onnx-whisper/, 'Whisper tiny (sherpa-onnx)', 'Trascrizione'],
  [/demucs/, 'Demucs (separazione audio)', 'Musica'],
  [/(it_it|en_us|en_gb)-\w+-(low|medium|high)/, 'Piper (voci)', 'Voce'],
  [/u2net/, 'U2Net (rimozione sfondo)', 'Immagini'],
  [/gpen-bfr|detection_resnet|parsing_(parsenet|bisenet)/, 'Restauro volti (facexlib)', 'Volti'],
  [/clip_l/, 'CLIP-L (encoder)', 'Componenti'],
  [/ultrasharp|realesrgan/, 'Upscaler', 'Componenti'],
  [/qwen3[-_ ]?8b/, 'Qwen3-8B', 'LLM'],
  [/ggml[-_](tiny|base|small|medium|large)/, 'Whisper (whisper.cpp)', 'Trascrizione'],
  [/glm[-_ ]?5\.3[-_ ]?flash[-_ ]?uncensored/, 'GLM-5.3 Flash Uncensored', 'LLM'],
  [/glm[-_ ]?5\.3/, 'GLM-5.3', 'LLM'],
  [/qwen3\.8[-_ ]?27b[-_ ]?abliterated/, 'Qwen3.8-27B abliterated', 'LLM'],
  [/qwen3\.8[-_ ]?27b/, 'Qwen3.8-27B', 'LLM'],
  [/qwen3\.6[-_ ]?35b/, 'Qwen3.6-35B', 'LLM'],
  [/qwen3[-_ ]?embedding/, 'Qwen3 Embedding', 'Embedding'],
  [/bge[-_]small/, 'BGE small', 'Embedding'],
  [/llama[-_ ]?3\.2/, 'Llama 3.2', 'LLM'],
  [/gemma[-_ ]?4[-_ ]?31b/, 'Gemma 4 31B', 'LLM'],
  [/gemma4[-_]e2b/, 'Gemma 4 E2B (encoder)', 'Componenti'],
  [/optguideondevicemodel/, 'Gemini Nano (in Chrome)', 'LLM'],
  [/tribev2/, 'TRIBE v2', 'Ricerca'],
  [/vjepa/, 'V-JEPA 2', 'Ricerca'],
  [/w2v[-_]bert/, 'Wav2Vec-BERT 2.0', 'Ricerca'],
  [/t5xxl/, 'T5-XXL (encoder)', 'Componenti'],
  [/eva02[-_]clip/, 'EVA02 CLIP', 'Componenti'],
  [/codeformer/, 'CodeFormer', 'Volti'],
  [/gfpgan/, 'GFPGAN', 'Volti'],
  [/inswapper/, 'InSwapper', 'Volti'],
  [/instantid|ip-adapter/, 'InstantID', 'Volti'],
  [/antelopev2|buffalo_|insightface/, 'InsightFace', 'Volti'],
  [/sam[-_]vit/, 'SAM (segmentazione)', 'Componenti'],
  [/nsfw/, 'Rilevatore NSFW', 'Componenti'],
  [/models\\controlnet/, 'ControlNet', 'Componenti'],
];

// Ordine fisso delle categorie: lo stesso in tutta la pagina.
export const KINDS = ['LLM', 'Immagini', 'Video', 'Voce', 'Trascrizione', 'Musica', 'Embedding', 'Volti', 'Componenti', 'Ricerca', 'App', 'Altro'];

const COMFY_KIND = { checkpoints: 'Immagini', diffusion_models: 'Immagini', unet: 'Immagini', loras: 'Immagini', vae: 'Componenti', clip: 'Componenti', text_encoders: 'Componenti', upscale_models: 'Componenti', controlnet: 'Componenti', facerestore_models: 'Volti', insightface: 'Volti', sams: 'Componenti' };

function pretty(file) {
  return path.basename(file).replace(/\.[^.]+$/, '')
    .replace(/-\d{5}-of-\d{5}$/i, '')
    .replace(/[-_.](?:i?q\d[\w]*|ud-[\w]+|f16|fp16|fp8|int8|gguf)(?:[-_.][\w]+)?$/i, '');
}

function classify(probe, fileForName, fullPath) {
  for (const [re, family, kind] of RULES) if (re.test(probe)) return { family, kind };
  const n = norm(fullPath);
  if (n.includes('blackmagic design')) return { family: 'DaVinci Resolve (modelli neurali)', kind: 'App' };
  if (n.includes('\\google\\chrome\\')) return { family: 'Modelli interni di Chrome', kind: 'App' };
  const comfy = n.match(/\\comfyui\\models\\([^\\]+)\\/);
  const kind = comfy ? (COMFY_KIND[comfy[1]] || 'Altro') : (/\.gguf$/i.test(fullPath) || /qwen|llama|gemma|glm|mistral|deepseek|phi-/i.test(fileForName) ? 'LLM' : 'Altro');
  return { family: pretty(fileForName), kind };
}

function quantOf(name) {
  const m = name.match(/(UD-Q\d[\w]*|IQ\d[_\w]*|Q\d_[\w]*|Q\d[A-Z_]*|int8|FP8|fp16|bf16)/i);
  return m ? m[1].replace(/-\d{5}.*/, '') : '';
}

function looksLikeModelBin(p) {
  const l = norm(p);
  return /ggml-|model|weights|pytorch|adapter|whisper/.test(path.basename(l)) || l.includes('blackmagic design') || /\\(models?|modelli)\\/.test(l);
}

export function buildModels(deep, label) {
  const fam = new Map();
  const add = (cl, loc) => {
    if (!fam.has(cl.family)) fam.set(cl.family, { name: cl.family, kind: cl.kind, size: 0, locations: new Map(), quants: new Set(), modified: null });
    const f = fam.get(cl.family);
    f.size += loc.size;
    if (loc.quant) f.quants.add(loc.quant);
    if (loc.modified && (!f.modified || loc.modified > f.modified)) f.modified = loc.modified;
    const key = norm(loc.dir);
    const e = f.locations.get(key) || { label: loc.label, path: loc.dir, size: 0, files: [] };
    e.size += loc.size;
    if (loc.file) e.files.push(loc.file);
    f.locations.set(key, e);
  };

  for (const h of deep) {
    if (h.k === 'hf') {
      const base = path.basename(h.p);
      const repo = base.replace(/^models--/, '').replace(/--/g, '/');
      const realSize = hfSize(h.p, h.s);
      if (realSize < 1024 * 1024) continue;
      const probe = repo.toLowerCase();
      const cl = classify(probe, repo.split('/').pop(), h.p);
      add(cl, { dir: h.p, size: realSize, label: `${label(h.p)} · ${repo}`, quant: quantOf(repo), modified: h.m });
    } else if (h.k === 'model') {
      if (/\.bin$/i.test(h.p) && (h.s < 100 * 1024 * 1024 || !looksLikeModelBin(h.p))) continue;
      const dir = path.dirname(h.p), file = path.basename(h.p);
      const probe = (path.basename(dir) + '\\' + file).toLowerCase() + ' ' + norm(h.p).replace(/^.*\\(comfyui\\models\\[^\\]+)\\.*$/, '$1').replace('comfyui\\', '');
      const cl = classify(/optguide|blackmagic/.test(norm(h.p)) ? norm(h.p) : probe, file, h.p);
      add(cl, { dir, size: h.s, label: label(h.p), quant: quantOf(file), file, modified: h.m });
    }
  }

  return [...fam.values()].map((f) => {
    const locations = [...f.locations.values()].sort((a, b) => b.size - a.size);
    return {
      id: `modello:${slug(f.name)}`, cat: 'modello', name: f.name, group: f.kind,
      size: f.size, status: 'rilevato', quants: [...f.quants], modified: f.modified,
      places: uniq(locations.map((l) => l.label.split(' · ')[0])),
      locations, path: locations[0]?.path,
      description: f.size < 50 * 1024 * 1024 && f.kind !== 'Componenti' ? 'Solo file di configurazione: i pesi del modello non sono su questo PC.' : undefined,
    };
  }).sort((a, b) => b.size - a.size);
}

// Parole usate per incrociare le memorie di Claude con quello che sta davvero sul disco.
const TOKEN = /\b(Qwen|GLM|Gemma|Llama|Mistral|DeepSeek|Phi|FLUX|Flux|SDXL|Wan|Hunyuan|Kokoro|XTTS|Piper|F5-TTS|MusicGen|Ollama|LM Studio|Orca|Maya|Colibr[ìi]|[Ff]aster-[Ww]hisper|Whisper|ComfyUI|Unsloth|Remotion|Manim|Chatterbox|rembg|LTX|ACE-Step|Demucs|OmniVoice|VoiceStudio)(?:[-\s]?(?:\d[\w.]*|Flash|TTS|Image|Embedding|Uncensored|[A-Z]\d\w*))*(?![\w])/g;

function parts(s) {
  const l = s.toLowerCase();
  return { family: (l.match(/^[a-zàì]+/) || [''])[0], sizes: l.match(/\b\d+(?:\.\d+)?b\b/g) || [], versions: (l.match(/(?<![\d.])\d+\.\d+(?!\d*b\b)/g) || []) };
}

export function matchMention(token, foundNames) {
  const p = parts(token);
  return foundNames.some((n) => {
    const l = n.toLowerCase();
    if (!l.includes(p.family)) return false;
    const fs = l.match(/\b\d+(?:\.\d+)?b\b/g) || [];
    const fv = l.match(/\d+\.\d+/g) || [];
    return p.sizes.every((s) => fs.includes(s)) && p.versions.every((v) => fv.includes(v));
  });
}
export function extractMentions(text) {
  const out = new Map();
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0].replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim();
    if (t.length < 3) continue;
    const k = t.toLowerCase();
    if (!out.has(k)) out.set(k, t);
  }
  return [...out.values()];
}
