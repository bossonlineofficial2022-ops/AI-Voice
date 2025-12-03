import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

// Default Thai script from the prompt
const DEFAULT_SCRIPT = `หน้าปัด Diamond Pave Dial. เลขอารบิกนูนต่ำสวยงาม ตัวเรือนทองคำ 18K Rose Gold ฝังเพชรมารอบเรือน สวยงามมากๆ ขนาดประมาณ 41 mm. ทรงถังเบียร์ดู Modern มากครับ เครื่อง Automatic movement เดินดีตามมาตรฐานใส่ได้ทุกวัน`;

const VOICES = [
  { name: 'Puck', label: 'Puck (Energetic)', icon: 'fa-bolt' },
  { name: 'Kore', label: 'Kore (Balanced)', icon: 'fa-scale-balanced' },
  { name: 'Fenrir', label: 'Fenrir (Deep)', icon: 'fa-bullhorn' },
  { name: 'Charon', label: 'Charon (Deep)', icon: 'fa-microphone-lines' },
  { name: 'Zephyr', label: 'Zephyr (Calm)', icon: 'fa-wind' },
];

function App() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize Audio Context on user interaction to avoid autoplay policy issues
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const decode = (base64: string) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const decodeAudioData = (
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number = 24000,
    numChannels: number = 1
  ): AudioBuffer => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        // Convert Int16 to Float32 [-1.0, 1.0]
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  };

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const createWavUrl = (samples: Uint8Array, sampleRate: number): string => {
    const buffer = new ArrayBuffer(44 + samples.length);
    const view = new DataView(buffer);
  
    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // file length
    view.setUint32(4, 36 + samples.length, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, samples.length, true);
  
    // write the PCM samples
    new Uint8Array(buffer).set(samples, 44);
  
    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    
    setIsGenerating(true);
    setAudioBuffer(null);
    setDownloadUrl(null);
    setIsPlaying(false);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const promptText = `
You are a professional Thai voice-over narrator for a TikTok short video.
Read the script in Thai with energetic and punchy tone.
Start strong with a hook, then keep the rhythm fast and engaging.
Make it dramatic but casual, with dynamic pauses for effect.

Script:
${script}
      `.trim();

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        const ctx = getAudioContext();
        const rawBytes = decode(base64Audio);
        const buffer = decodeAudioData(rawBytes, ctx, 24000, 1); // TTS model usually outputs 24kHz
        
        const wavUrl = createWavUrl(rawBytes, 24000);
        
        setAudioBuffer(buffer);
        setDownloadUrl(wavUrl);
      } else {
        console.error("No audio data received");
      }

    } catch (error) {
      console.error("Generation error:", error);
      alert("Failed to generate audio. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlay = () => {
    if (!audioBuffer) return;
    const ctx = getAudioContext();

    // Stop previous instance if playing
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // ignore if already stopped
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    source.onended = () => setIsPlaying(false);
    
    source.start();
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const handleStop = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      setIsPlaying(false);
    }
  };

  const handleReset = () => {
    setAudioBuffer(null);
    setDownloadUrl(null);
    setIsPlaying(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#1f1f1f] rounded-3xl shadow-2xl overflow-hidden border border-gray-800">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-500 to-pink-500 p-6 text-center">
          <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white drop-shadow-lg">
            <i className="fa-brands fa-tiktok mr-3"></i>
            TikTok Voice-Over
          </h1>
          <p className="text-white/90 font-medium mt-1">Professional Thai Narrator Generator</p>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          
          {/* Voice Selection */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {VOICES.map((voice) => (
              <button
                key={voice.name}
                onClick={() => setSelectedVoice(voice.name)}
                className={`p-3 rounded-xl flex flex-col items-center justify-center gap-2 text-xs font-bold transition-all duration-200 border-2 ${
                  selectedVoice === voice.name
                    ? 'border-cyan-400 bg-gray-800 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                    : 'border-transparent bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <i className={`fa-solid ${voice.icon} text-lg`}></i>
                {voice.name}
              </button>
            ))}
          </div>

          {/* Script Input */}
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-xl opacity-20 group-hover:opacity-40 transition duration-300 blur"></div>
            <textarea
              className="relative w-full bg-[#121212] text-gray-100 rounded-xl p-4 min-h-[180px] focus:outline-none focus:ring-0 resize-none leading-relaxed text-lg font-light border border-gray-700"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Enter your script here..."
            ></textarea>
            <div className="absolute bottom-4 right-4 text-xs text-gray-500">
              {script.length} chars
            </div>
          </div>

          {/* Action Area */}
          <div className="flex flex-col gap-4">
            
            {!audioBuffer ? (
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`neon-btn w-full py-4 rounded-full font-bold text-lg uppercase tracking-wide flex items-center justify-center gap-3 ${
                  isGenerating 
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : 'bg-white text-black hover:bg-gray-100'
                }`}
              >
                {isGenerating ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                    Generating Voice...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-wand-magic-sparkles text-pink-500"></i>
                    Generate Narration
                  </>
                )}
              </button>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4 animate-fade-in">
                 <button
                  onClick={isPlaying ? handleStop : handlePlay}
                  className={`flex-1 py-4 rounded-full font-bold text-lg uppercase tracking-wide flex items-center justify-center gap-3 transition-colors ${
                    isPlaying 
                      ? 'bg-pink-500 text-white hover:bg-pink-600'
                      : 'bg-cyan-500 text-black hover:bg-cyan-400'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <i className="fa-solid fa-stop"></i>
                      Stop
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-play"></i>
                      Play Result
                    </>
                  )}
                </button>
                
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download="tiktok-voiceover.wav"
                    className="flex-1 py-4 rounded-full font-bold text-lg uppercase tracking-wide flex items-center justify-center gap-3 bg-gray-700 text-white hover:bg-gray-600 hover:text-cyan-400 transition-colors"
                  >
                    <i className="fa-solid fa-download"></i>
                    Save Audio
                  </a>
                )}

                <button 
                  onClick={handleReset}
                  className="px-6 py-4 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  title="Reset"
                >
                  <i className="fa-solid fa-rotate-right"></i>
                </button>
              </div>
            )}
            
            {/* Visualizer Placeholder / Tips */}
            <div className="text-center mt-2">
              <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
                <i className="fa-solid fa-info-circle"></i>
                AI Tip: Use punctuation like "..." for dramatic pauses.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);