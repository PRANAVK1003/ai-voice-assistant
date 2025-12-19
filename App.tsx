
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { TranscriptionEntry, GroundingSource } from './types';
import { decode, encode, decodeAudioData, createBlob } from './utils';
import AudioVisualizer from './components/AudioVisualizer';
import TranscriptionList from './components/TranscriptionList';

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [entries, setEntries] = useState<TranscriptionEntry[]>([]);
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mutable refs for audio handling
  const nextStartTimeRef = useRef(0);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  const stopSession = useCallback(() => {
    setIsActive(false);
    setAudioStream(null);
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
    audioSourcesRef.current.forEach(s => s.stop());
    audioSourcesRef.current.clear();
    sessionPromiseRef.current?.then(session => session.close());
    sessionPromiseRef.current = null;
  }, []);

  const startSession = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const audioContextIn = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioContextOut = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextInRef.current = audioContextIn;
      audioContextOutRef.current = audioContextOut;
      nextStartTimeRef.current = 0;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            const source = audioContextIn.createMediaStreamSource(stream);
            const scriptProcessor = audioContextIn.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextIn.destination);
            setIsActive(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOut) {
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                audioContextOut,
                24000,
                1
              );
              
              const source = audioContextOut.createBufferSource();
              source.buffer = audioBuffer;
              const outputNode = audioContextOut.createGain();
              source.connect(outputNode);
              outputNode.connect(audioContextOut.destination);

              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOut.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              
              audioSourcesRef.current.add(source);
              source.onended = () => audioSourcesRef.current.delete(source);
            }

            // Handle Interruptions
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => s.stop());
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            }

            // Turn Complete
            if (message.serverContent?.turnComplete) {
              if (currentInputTranscriptionRef.current) {
                setEntries(prev => [...prev, {
                  id: Math.random().toString(36),
                  role: 'user',
                  text: currentInputTranscriptionRef.current,
                  timestamp: new Date()
                }]);
              }
              if (currentOutputTranscriptionRef.current) {
                setEntries(prev => [...prev, {
                  id: Math.random().toString(36),
                  role: 'assistant',
                  text: currentOutputTranscriptionRef.current,
                  timestamp: new Date()
                }]);
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }

            // Search Grounding Metadata
            if (message.serverContent?.groundingMetadata?.groundingChunks) {
              const chunks = message.serverContent.groundingMetadata.groundingChunks;
              const newSources: GroundingSource[] = [];
              chunks.forEach((chunk: any) => {
                if (chunk.web) {
                  newSources.push({
                    title: chunk.web.title || 'Untitled Source',
                    uri: chunk.web.uri
                  });
                }
              });
              if (newSources.length > 0) {
                setGroundingSources(prev => {
                  const combined = [...prev, ...newSources];
                  // Basic deduplication
                  return Array.from(new Map(combined.map(s => [s.uri, s])).values());
                });
              }
            }
          },
          onerror: (e) => {
            console.error('Gemini Live error:', e);
            setError('Connection error occurred. Please try again.');
            stopSession();
          },
          onclose: () => {
            console.log('Gemini Live closed');
            setIsActive(false);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: 'You are a professional Research Assistant. Provide detailed, factual information. Use the Google Search tool when appropriate for recent or factual data. Keep your responses concise yet informative for voice interaction.',
          tools: [{ googleSearch: {} } as any],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });

      sessionPromiseRef.current = sessionPromise;
    } catch (err) {
      console.error('Failed to start session:', err);
      setError('Could not access microphone. Please check permissions.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
            Voice Research Assistant
          </h1>
          <p className="text-gray-400 text-sm mt-1">Powered by Gemini Live & Search Grounding</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></div>
          <span className="text-xs font-medium uppercase tracking-widest text-gray-500">
            {isActive ? 'Live Session Active' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Main Container */}
      <main className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6 mb-24 overflow-hidden min-h-[500px]">
        {/* Left Column: Stats & Audio Visualizer */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="p-6 rounded-2xl glass-morphism h-fit">
            <h2 className="text-lg font-semibold mb-4 text-indigo-300">Audio Interface</h2>
            <AudioVisualizer isListening={isActive && !isMuted} audioStream={audioStream} />
            
            <div className="space-y-4 mt-6">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Status</span>
                <span className={isActive ? 'text-green-400' : 'text-gray-500'}>
                  {isActive ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Microphone</span>
                <span className={isMuted ? 'text-orange-400' : 'text-blue-400'}>
                  {isMuted ? 'Muted' : 'Active'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Voice Transcripts</span>
                <span className="text-gray-200">{entries.length} segments</span>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-2xl glass-morphism h-full flex-grow">
            <h2 className="text-lg font-semibold mb-4 text-indigo-300">Quick Tips</h2>
            <ul className="text-sm text-gray-400 space-y-3 list-disc pl-5">
              <li>Speak naturally about any topic.</li>
              <li>Ask for "the latest news" to trigger search.</li>
              <li>"Analyze this [topic]" for deep research.</li>
              <li>The assistant listens in real-time.</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Transcription & Grounding */}
        <div className="lg:col-span-2 rounded-2xl glass-morphism overflow-hidden flex flex-col h-full border border-white/5">
          <TranscriptionList entries={entries} groundingSources={groundingSources} />
        </div>
      </main>

      {/* Persistent Controls Overlay */}
      <div className="fixed bottom-0 left-0 right-0 p-6 pointer-events-none">
        <div className="max-w-md mx-auto flex items-center justify-center gap-4 glass-morphism rounded-full p-2 pointer-events-auto shadow-2xl border border-white/10">
          {!isActive ? (
            <button
              onClick={startSession}
              className="accent-gradient hover:scale-105 active:scale-95 transition-all w-full text-white font-bold py-3 px-8 rounded-full flex items-center justify-center gap-3"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Start Researching
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-4 rounded-full transition-colors ${
                  isMuted 
                    ? 'bg-orange-500/20 text-orange-500 border border-orange-500/30' 
                    : 'bg-white/5 text-gray-300 hover:bg-white/10'
                }`}
              >
                {isMuted ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
              
              <button
                onClick={stopSession}
                className="bg-red-500 hover:bg-red-600 active:scale-95 transition-all text-white font-bold py-3 px-10 rounded-full flex items-center justify-center gap-3"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                End Session
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
