import React, { useEffect, useState, useRef } from 'react';
import { AppState, Mood } from '../types';

interface OrbProps {
  state: AppState;
  mood: Mood;
  isMuted?: boolean;
}

const Orb: React.FC<OrbProps> = ({ state, mood, isMuted = false }) => {
  const [tilt, setTilt] = useState(0);
  const [blink, setBlink] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [mouthJitter, setMouthJitter] = useState(0);
  const idleTimerRef = useRef<number | null>(null);

  const effectiveState = isMuted ? AppState.IDLE : state;

  useEffect(() => {
    if (effectiveState === AppState.IDLE || effectiveState === AppState.STANDBY) {
      const scheduleNextBlink = () => {
        const nextBlinkIn = 2000 + Math.random() * 5000;
        idleTimerRef.current = window.setTimeout(() => {
          setBlink(true);
          setTimeout(() => setBlink(false), 150);
          scheduleNextBlink();
        }, nextBlinkIn);
      };

      const scheduleNextGaze = () => {
        const nextGazeIn = 3000 + Math.random() * 4000;
        setTimeout(() => {
          if (effectiveState === AppState.IDLE || effectiveState === AppState.STANDBY) {
            setGaze({
              x: (Math.random() - 0.5) * 6,
              y: (Math.random() - 0.5) * 3
            });
            scheduleNextGaze();
          }
        }, nextGazeIn);
      };

      scheduleNextBlink();
      scheduleNextGaze();
    } else {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setBlink(false);
      setGaze({ x: 0, y: 0 });
    }

    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [effectiveState]);

  useEffect(() => {
    let interval: any;
    if (effectiveState === AppState.LISTENING) {
      interval = setInterval(() => {
        setTilt(prev => (prev === 4 ? -4 : 4));
      }, mood === Mood.HAPPY || mood === Mood.EXCITED ? 800 : 2000);
    } else if (effectiveState === AppState.SPEAKING) {
      interval = setInterval(() => {
        setMouthJitter(Math.random() * 4);
      }, 60);
    } else {
      setTilt(0);
      setMouthJitter(0);
    }
    return () => clearInterval(interval);
  }, [effectiveState, mood]);

  const getColors = () => {
    if (effectiveState === AppState.ERROR) return 'from-red-800 to-red-950 shadow-red-900/50';
    if (effectiveState === AppState.RECONNECTING) return 'from-orange-600 to-orange-900 shadow-orange-700/50 animate-pulse';
    if (effectiveState === AppState.CONNECTING) return 'from-yellow-400 to-orange-500 animate-thinking';
    if (effectiveState === AppState.SLEEP) return 'from-slate-800 to-slate-900';

    if (isMuted) return 'from-slate-700 to-slate-800 shadow-slate-900/50 grayscale-[0.5]';

    switch (mood) {
      case Mood.HAPPY:
      case Mood.EXCITED:
        return 'from-amber-300 via-yellow-400 to-orange-500 shadow-yellow-500/80 scale-110';
      case Mood.SAD:
        return 'from-blue-600 via-indigo-800 to-slate-900 shadow-blue-900/40 opacity-90';
      case Mood.SURPRISED:
        return 'from-cyan-300 via-sky-400 to-purple-500 shadow-cyan-400/70 scale-105';
      case Mood.ANGRY:
        return 'from-rose-600 via-red-800 to-black shadow-rose-900/70';
      case Mood.THINKING:
        return 'from-purple-500 via-indigo-600 to-slate-900 shadow-purple-900/50 animate-thinking';
      case Mood.CONFUSED:
        return 'from-emerald-400 via-teal-600 to-slate-900 shadow-teal-500/30';
      default:
        return effectiveState === AppState.LISTENING 
          ? 'from-cyan-400 via-blue-500 to-indigo-600 shadow-cyan-500/70'
          : 'from-indigo-600 to-purple-800 shadow-indigo-500/40';
    }
  };

  const renderFace = () => {
    const browClass = "transition-all duration-700 ease-in-out stroke-white fill-none stroke-[3] stroke-linecap-round";
    const eyeBaseClass = "transition-all duration-500 ease-in-out fill-white/20";
    const pupilClass = "transition-all duration-500 ease-in-out fill-white";
    const mouthClass = "transition-all duration-300 ease-in-out stroke-white fill-none stroke-[4] stroke-linecap-round";
    const blushClass = "transition-all duration-1000 ease-in-out fill-rose-400/40 blur-lg";

    let browL = "M25 35 Q35 30 45 35";
    let browR = "M55 35 Q65 30 75 35";
    let mouthPath = `M40 ${75 + mouthJitter} Q50 ${80 - mouthJitter} 60 ${75 + mouthJitter}`; 
    let pupilSize = 4;
    let showBlush = false;

    switch (mood) {
      case Mood.HAPPY:
      case Mood.EXCITED:
        browL = "M25 30 Q35 22 45 30";
        browR = "M55 30 Q65 22 75 30";
        mouthPath = `M25 ${70 + mouthJitter} Q50 ${95 - mouthJitter} 75 ${70 + mouthJitter}`;
        pupilSize = mood === Mood.EXCITED ? 7 : 5.5;
        showBlush = true;
        break;
      case Mood.SAD:
        browL = "M25 32 Q35 42 45 38";
        browR = "M55 38 Q65 42 75 32";
        mouthPath = "M35 85 Q50 72 65 85";
        pupilSize = 3;
        break;
      case Mood.SURPRISED:
        browL = "M25 22 Q35 15 45 22";
        browR = "M55 22 Q65 15 75 22";
        mouthPath = `M40 ${82 - mouthJitter} A${10 + mouthJitter} ${10 + mouthJitter} 0 1 0 ${60} ${82 - mouthJitter}`;
        pupilSize = 7;
        break;
      case Mood.ANGRY:
        browL = "M25 45 Q35 48 45 35";
        browR = "M55 35 Q65 48 75 45";
        mouthPath = "M30 85 Q50 70 70 85";
        pupilSize = 3.5;
        break;
      case Mood.CONFUSED:
        browL = "M25 25 Q35 30 45 40";
        browR = "M55 30 Q65 25 75 25";
        mouthPath = "M45 80 Q50 75 55 80";
        pupilSize = 4.5;
        break;
      case Mood.THINKING:
        browL = "M25 28 Q35 25 45 30";
        browR = "M55 42 Q65 45 75 42";
        mouthPath = "M42 78 Q50 78 58 78";
        pupilSize = 4;
        break;
    }

    if (effectiveState === AppState.SLEEP) {
      browL = "M25 40 Q35 42 45 40";
      browR = "M55 40 Q65 42 75 40";
      mouthPath = "M45 78 Q50 80 55 78";
      pupilSize = 0;
    }

    if (effectiveState === AppState.RECONNECTING) {
      browL = "M25 35 Q35 40 45 35";
      browR = "M55 35 Q65 40 75 35";
      mouthPath = "M40 80 Q50 75 60 80";
      pupilSize = 3;
    }

    return (
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {showBlush && (
          <g>
            <circle cx="20" cy="65" r="12" className={blushClass} />
            <circle cx="80" cy="65" r="12" className={blushClass} />
          </g>
        )}
        <path d={browL} className={browClass} />
        <path d={browR} className={browClass} />
        <g transform={`translate(${gaze.x}, ${gaze.y})`}>
          <circle cx="35" cy="50" r="9" className={eyeBaseClass} />
          <circle cx="65" cy="50" r="9" className={eyeBaseClass} />
          {!blink && effectiveState !== AppState.SLEEP && (
            <>
              <circle cx="35" cy="50" r={pupilSize} className={pupilClass} />
              <circle cx="65" cy="50" r={pupilSize} className={pupilClass} />
            </>
          )}
        </g>
        <path d={mouthPath} className={mouthClass} />
      </svg>
    );
  };

  return (
    <div 
      className={`relative w-52 h-52 rounded-full bg-gradient-to-br ${getColors()} transition-all duration-300 flex items-center justify-center overflow-hidden shadow-2xl z-10`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="w-36 h-36">{renderFace()}</div>
      {/* Mood specific glow pulses */}
      <div className={`absolute inset-0 rounded-full opacity-30 blur-3xl transition-all duration-300 ${
        mood === Mood.HAPPY || mood === Mood.EXCITED ? 'bg-yellow-400 animate-pulse scale-150' :
        mood === Mood.ANGRY ? 'bg-red-600 animate-pulse scale-110' :
        mood === Mood.SAD ? 'bg-blue-600 scale-90' :
        'bg-transparent'
      }`} />
    </div>
  );
};

export default Orb;
