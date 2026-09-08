'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// ESP32 ka WiFi WebSocket address yahan daalo
const ESP32_WS_URL = 'ws://192.168.1.100:81';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type RobotState = 'IDLE' | 'MANUAL' | 'EMERGENCY' | 'VOICE';

interface Telemetry {
  state: RobotState;
  distance_cm: number;
  room_temp: number;
  obj_temp: number;
}

export default function RobotControlPage() {
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);

  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [lastCmd, setLastCmd] = useState('—');
  const [log, setLog] = useState<string[]>([]);
  const [speed, setSpeed] = useState(150);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 30));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnStatus('connecting');
    addLog('ESP32 se connect kar raha hai...');
    const ws = new WebSocket(ESP32_WS_URL);
    wsRef.current = ws;
    ws.onopen = () => { setConnStatus('connected'); addLog('✅ ESP32 se connected!'); };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.telemetry) setTelemetry(data.telemetry);
        if (data.status === 'ok') addLog(`✔ ACK: ${data.cmd}`);
        if (data.status === 'error') addLog(`✘ Error: ${data.reason}`);
      } catch (_) {}
    };
    ws.onerror = () => { setConnStatus('error'); addLog('❌ Connection error. IP check karo.'); };
    ws.onclose = () => { setConnStatus('disconnected'); addLog('🔌 Disconnected.'); };
  }, [addLog]);

  const disconnect = useCallback(() => { wsRef.current?.close(); }, []);

  const sendCmd = useCallback((cmd: string, extra?: Record<string, unknown>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) { addLog('⚠️ Connected nahi hai!'); return; }
    const payload = JSON.stringify({ cmd, ...extra });
    wsRef.current.send(payload);
    setLastCmd(cmd);
    addLog(`→ Sent: ${payload}`);
  }, [addLog]);

  const toggleVoice = useCallback(() => {
    if (voiceMode) {
      recognitionRef.current?.stop();
      setVoiceMode(false);
      sendCmd('voice_mode_stop');
      addLog('🎤 Voice mode off');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { addLog('⚠️ Browser voice support nahi hai'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'hi-IN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    recognition.onresult = (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
      addLog(`🗣 Suna: "${text}"`);
      const map: Record<string, string> = {
        'aage': 'move_forward', 'forward': 'move_forward', 'chalo': 'move_forward',
        'peeche': 'move_backward', 'back': 'move_backward',
        'left': 'turn_left', 'baye': 'turn_left',
        'right': 'turn_right', 'daaye': 'turn_right',
        'ruko': 'stop', 'stop': 'stop', 'band': 'stop',
        'haath': 'hand_wave', 'wave': 'hand_wave', 'namaste': 'hand_wave',
        'sar': 'head_nod', 'nod': 'head_nod', 'haan': 'head_nod',
        'emergency': 'emergency_stop', 'danger': 'emergency_stop',
      };
      const matched = Object.entries(map).find(([key]) => text.includes(key));
      if (matched) sendCmd(matched[1]);
      else addLog(`⚠️ Samajh nahi aaya: "${text}"`);
    };
    recognition.onerror = () => addLog('❌ Voice error');
    recognition.start();
    setVoiceMode(true);
    sendCmd('voice_mode_start');
    addLog('🎤 Voice mode ON — boliye...');
  }, [voiceMode, sendCmd, addLog]);

  useEffect(() => {
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (held.has(e.key)) return;
      held.add(e.key);
      if (e.key === 'ArrowUp') sendCmd('move_forward', { value: speed });
      if (e.key === 'ArrowDown') sendCmd('move_backward', { value: speed });
      if (e.key === 'ArrowLeft') sendCmd('turn_left', { value: speed });
      if (e.key === 'ArrowRight') sendCmd('turn_right', { value: speed });
      if (e.key === ' ') sendCmd('stop');
    };
    const onUp = (e: KeyboardEvent) => {
      held.delete(e.key);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) sendCmd('stop');
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [sendCmd, speed]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const connColor = { disconnected: 'text-text-muted', connecting: 'text-yellow-400 animate-pulse', connected: 'text-green-400', error: 'text-red-400' }[connStatus];
  const connDot = { disconnected: 'bg-gray-500', connecting: 'bg-yellow-400 animate-pulse', connected: 'bg-green-400', error: 'bg-red-500' }[connStatus];
  const stateColor: Record<RobotState, string> = { IDLE: 'text-gray-400', MANUAL: 'text-blue-400', EMERGENCY: 'text-red-500 animate-pulse', VOICE: 'text-purple-400' };

  const DirBtn = ({ label, cmd, icon }: { label: string; cmd: string; icon: string }) => (
    <button
      onPointerDown={() => sendCmd(cmd, { value: speed })}
      onPointerUp={() => sendCmd('stop')}
      onPointerLeave={() => sendCmd('stop')}
      className="bg-panel border border-border-subtle rounded-xl w-16 h-16 flex flex-col items-center justify-center gap-1 hover:bg-yellow-500/10 hover:border-yellow-500/40 active:scale-95 active:bg-yellow-500/20 transition-all select-none cursor-pointer"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-[9px] font-black uppercase tracking-widest text-text-muted">{label}</span>
    </button>
  );

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-widest text-text-main">Robot Control</h1>
          <p className="text-text-muted mt-1 text-sm tracking-widest uppercase">Kalvix Serve — Live Command Center</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest ${connColor}`}>
            <span className={`w-2 h-2 rounded-full ${connDot}`}></span>{connStatus}
          </span>
          {connStatus !== 'connected'
            ? <button onClick={connect} className="bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors">Connect</button>
            : <button onClick={disconnect} className="bg-panel border border-red-900 text-red-400 hover:bg-red-500/10 font-black text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors">Disconnect</button>
          }
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="col-span-2 flex flex-col gap-6">
          <button onClick={() => sendCmd('emergency_stop')} className="w-full bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-lg uppercase tracking-widest py-4 rounded-xl shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-all">
            ⚡ EMERGENCY STOP
          </button>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-panel border border-border-subtle rounded-xl p-6 flex flex-col items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-widest text-text-muted mb-3">Movement Control</h2>
              <DirBtn label="Forward" cmd="move_forward" icon="▲" />
              <div className="flex gap-2">
                <DirBtn label="Left" cmd="turn_left" icon="◀" />
                <button onClick={() => sendCmd('stop')} className="bg-page border border-border-subtle rounded-xl w-16 h-16 flex flex-col items-center justify-center gap-1 hover:border-red-500/40 hover:bg-red-500/10 transition-all cursor-pointer">
                  <span className="text-xl">⏹</span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-text-muted">Stop</span>
                </button>
                <DirBtn label="Right" cmd="turn_right" icon="▶" />
              </div>
              <DirBtn label="Back" cmd="move_backward" icon="▼" />
              <div className="w-full mt-4">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-text-muted mb-1">
                  <span>Speed</span><span>{speed}</span>
                </div>
                <input type="range" min={50} max={255} value={speed}
                  onChange={e => { const v = Number(e.target.value); setSpeed(v); sendCmd('set_speed', { value: v }); }}
                  className="w-full accent-yellow-500"
                />
              </div>
              <p className="text-[9px] text-text-muted mt-2 uppercase tracking-widest">Keyboard: Arrow Keys + Space</p>
            </div>
            <div className="bg-panel border border-border-subtle rounded-xl p-6 flex flex-col gap-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-text-muted">Appendage Control</h2>
              <button onClick={() => sendCmd('hand_wave')} className="flex-1 bg-page border border-border-subtle rounded-xl flex flex-col items-center justify-center gap-2 py-6 hover:border-yellow-500/40 hover:bg-yellow-500/5 active:scale-95 transition-all cursor-pointer">
                <span className="text-4xl">🤝</span>
                <span className="text-xs font-black uppercase tracking-widest text-text-muted">Wave Hands</span>
              </button>
              <button onClick={() => sendCmd('head_nod')} className="flex-1 bg-page border border-border-subtle rounded-xl flex flex-col items-center justify-center gap-2 py-6 hover:border-yellow-500/40 hover:bg-yellow-500/5 active:scale-95 transition-all cursor-pointer">
                <span className="text-4xl">🤖</span>
                <span className="text-xs font-black uppercase tracking-widest text-text-muted">Head Nod</span>
              </button>
              <button onClick={toggleVoice} className={`w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${voiceMode ? 'bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.5)] animate-pulse' : 'bg-page border border-border-subtle text-text-muted hover:border-purple-500/40 hover:text-purple-400'}`}>
                🎤 {voiceMode ? 'Voice ON — Bol Rahe Hain...' : 'Voice Command Mode'}
              </button>
              <button onClick={() => sendCmd('reset_emergency')} className="w-full py-3 bg-page border border-border-subtle text-text-muted hover:border-green-500/40 hover:text-green-400 rounded-xl font-black text-xs uppercase tracking-widest transition-colors">
                ✅ Reset Emergency
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-panel border border-border-subtle rounded-xl p-5">
            <h2 className="text-xs font-black uppercase tracking-widest text-text-muted mb-3">Robot State</h2>
            <div className={`text-3xl font-black tracking-widest ${telemetry ? stateColor[telemetry.state] : 'text-text-muted'}`}>
              {telemetry?.state ?? 'N/A'}
            </div>
            <div className="text-xs text-text-muted mt-2 uppercase tracking-widest">
              Last CMD: <span className="text-yellow-500 font-bold">{lastCmd}</span>
            </div>
          </div>

          <div className="bg-panel border border-border-subtle rounded-xl p-5">
            <h2 className="text-xs font-black uppercase tracking-widest text-text-muted mb-4">Live Telemetry</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Obstacle Dist.', value: telemetry ? `${telemetry.distance_cm.toFixed(1)} cm` : '—', icon: '📡', alert: !!(telemetry && telemetry.distance_cm > 0 && telemetry.distance_cm < 15) },
                { label: 'Room Temp', value: telemetry ? `${telemetry.room_temp.toFixed(1)} °C` : '—', icon: '🌡️', alert: false },
                { label: 'Object Temp', value: telemetry ? `${telemetry.obj_temp.toFixed(1)} °C` : '—', icon: '🍽️', alert: false },
              ].map(card => (
                <div key={card.label} className={`bg-page border rounded-lg p-3 ${card.alert ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-border-subtle'}`}>
                  <div className="text-lg">{card.icon}</div>
                  <div className={`text-lg font-black font-mono mt-1 ${card.alert ? 'text-red-400 animate-pulse' : 'text-text-main'}`}>{card.value}</div>
                  <div className="text-[9px] uppercase tracking-widest text-text-muted">{card.label}</div>
                </div>
              ))}
              <div className="bg-page border border-border-subtle rounded-lg p-3 col-span-2 flex items-center justify-between">
                <div>
                  <div className="text-lg">🔗</div>
                  <div className="text-xs font-black text-text-main mt-1">WiFi / WebSocket</div>
                  <div className="text-[9px] uppercase tracking-widest text-text-muted">ESP32 Link</div>
                </div>
                <span className={`text-xs font-black uppercase tracking-widest ${connStatus === 'connected' ? 'text-green-400' : 'text-text-muted'}`}>{connStatus}</span>
              </div>
            </div>
          </div>

          <div className="bg-panel border border-border-subtle rounded-xl p-5 flex flex-col flex-1 min-h-0">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-black uppercase tracking-widest text-text-muted">Command Log</h2>
              <button onClick={() => setLog([])} className="text-[9px] uppercase tracking-widest text-text-muted hover:text-red-400 transition-colors">Clear</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 font-mono">
              {log.length === 0 && <p className="text-text-muted text-xs">Koi log nahi...</p>}
              {log.map((entry, i) => (
                <div key={i} className="text-[10px] text-text-muted hover:text-text-main transition-colors">{entry}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
