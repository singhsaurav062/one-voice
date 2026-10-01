const $ = id => document.getElementById(id);
const recordButton = $('recordButton'), stopButton = $('stopButton'), fileInput = $('fileInput'), preview = $('preview'), previewAudio = $('previewAudio'), status = $('status');
let recorder, stream, chunks = [], audioBlob, timerInterval, startedAt, duration = 0, objectUrl;
const setStatus = message => { status.textContent = message; };
function showPreview(blob) { audioBlob = blob; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(blob); previewAudio.src = objectUrl; preview.classList.remove('hidden'); $('recordStage').classList.add('ready'); $('stageTitle').textContent = 'Your note is ready'; $('stageCopy').textContent = 'Take a listen, or record a new one.'; }
function timeString(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function stopStream() { stream?.getTracks().forEach(track => track.stop()); stream = null; }
recordButton.addEventListener('click', async () => {
  setStatus('');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setStatus('Recording is not supported in this browser. Choose an audio file instead.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mime = types.find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); stopStream(); showPreview(audioBlob); };
    recorder.start(); startedAt = Date.now(); duration = 0; $('timer').textContent = '00:00';
    $('recordStage').classList.add('recording'); $('stageTitle').textContent = 'I’m listening'; $('stageCopy').textContent = 'Speak freely. You can listen before sending.';
    recordButton.classList.add('hidden'); stopButton.classList.remove('hidden'); preview.classList.add('hidden');
    timerInterval = setInterval(() => { duration = Math.floor((Date.now() - startedAt) / 1000); $('timer').textContent = timeString(duration); if (duration >= 300) stopButton.click(); }, 250);
  } catch { setStatus('Microphone access is needed to record. Check your browser permissions or choose an audio file.'); }
});
stopButton.addEventListener('click', () => { if (!recorder || recorder.state === 'inactive') return; clearInterval(timerInterval); recorder.stop(); $('recordStage').classList.remove('recording'); $('timer').textContent = timeString(duration); recordButton.classList.remove('hidden'); stopButton.classList.add('hidden'); });
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (!file) return; if (!file.type.startsWith('audio/')) { setStatus('Please choose an audio file.'); return; } if (file.size > 25 * 1024 * 1024) { setStatus('Audio must be 25 MB or smaller.'); return; } duration = 0; showPreview(file); $('timer').textContent = 'FILE'; $('recordStage').classList.remove('recording'); setStatus(''); });
$('discardButton').addEventListener('click', () => { audioBlob = null; fileInput.value = ''; preview.classList.add('hidden'); $('recordStage').classList.remove('ready'); $('stageTitle').textContent = 'Ready when you are'; $('stageCopy').textContent = 'Your microphone stays in this tab until you choose to send.'; $('timer').textContent = '00:00'; setStatus(''); });
$('sendButton').addEventListener('click', async () => {
  if (!audioBlob) return;
  if (audioBlob.size > 25 * 1024 * 1024) { setStatus('Audio must be 25 MB or smaller.'); return; }
  const button = $('sendButton'); button.disabled = true; button.innerHTML = '<span class="spinner"></span><span>Making your private link…</span>'; setStatus('');
  try {
    const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': audioBlob.type || 'audio/webm', 'X-Upload-Key': $('uploadKey').value }, body: audioBlob });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`The server returned an unreadable response (HTTP ${response.status}). Please retry; if it continues, check the server terminal.`); }
    if (!response.ok) throw new Error(data.error || `Upload failed (HTTP ${response.status}).`);
    if (!data.url) throw new Error('The server did not return a share link. Please retry.');
    const link = new URL(data.url, location.origin).href; $('shareLink').textContent = link; $('composer').classList.add('hidden'); $('result').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { setStatus(error.message); button.disabled = false; button.innerHTML = 'Create private link <span aria-hidden="true">↗</span>'; }
});
$('copyButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('shareLink').textContent); $('copyButton').textContent = 'Copied ✓'; } catch { const range = document.createRange(); range.selectNodeContents($('shareLink')); getSelection().removeAllRanges(); getSelection().addRange(range); $('copyButton').textContent = 'Select and copy'; } });
$('startAgain').addEventListener('click', () => { $('result').classList.add('hidden'); $('composer').classList.remove('hidden'); $('discardButton').click(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
