import React, { useEffect, useRef } from 'react';
import { TranscriptEntry, Mood } from '../types';

interface TranscriptProps {
  entries: TranscriptEntry[];
}

const Transcript: React.FC<TranscriptProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [entries]);

  const translations = entries.filter(entry => entry.role === 'model');

  if (translations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-700 p-8 text-center">
        <div className="w-10 h-10 rounded-full border border-slate-800/50 flex items-center justify-center mb-3 opacity-20">
          <i className="fas fa-wave-square text-[10px]"></i>
        </div>
        <p className="text-[8px] uppercase tracking-[0.5em] font-black opacity-20">Awaiting Vibe...</p>
      </div>
    );
  }

  const getMoodStyles = (mood?: Mood) => {
    switch (mood) {
      case Mood.HAPPY:
      case Mood.EXCITED:
        return { text: 'text-yellow-100/90', icon: 'fa-sparkles text-yellow-500/50' };
      case Mood.SAD:
        return { text: 'text-blue-100/90', icon: 'fa-cloud text-blue-500/50' };
      case Mood.ANGRY:
        return { text: 'text-rose-100/90', icon: 'fa-fire text-rose-500/50' };
      case Mood.SURPRISED:
        return { text: 'text-cyan-100/90', icon: 'fa-bolt text-cyan-500/50' };
      case Mood.CONFUSED:
        return { text: 'text-emerald-100/90', icon: 'fa-question text-emerald-500/50' };
      default:
        return { text: 'text-indigo-100/90', icon: 'fa-quote-left text-indigo-500/20' };
    }
  };

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 flex flex-col space-y-8 scroll-smooth no-scrollbar">
      {translations.map((entry, idx) => {
        const styles = getMoodStyles(entry.mood);
        return (
          <div key={entry.timestamp + idx} className="w-full flex justify-center animate-[fadeIn_0.5s_ease-out]">
            <div className="w-full max-w-sm text-center group">
              <div className="mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <i className={`fas ${styles.icon} text-[8px]`}></i>
              </div>
              <p className={`text-[15px] font-medium leading-relaxed tracking-wide transition-colors duration-500 ${styles.text}`}>
                {entry.text}
              </p>
              <div className="mt-2 flex items-center justify-center gap-2 opacity-10">
                <div className="h-[1px] w-4 bg-white"></div>
                <span className="text-[6px] font-black uppercase tracking-[0.3em]">Salin • {entry.mood || 'Neutral'}</span>
                <div className="h-[1px] w-4 bg-white"></div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="h-12 w-full shrink-0"></div>
    </div>
  );
};

export default Transcript;
