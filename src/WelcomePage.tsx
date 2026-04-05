import React, { useState, useEffect } from 'react';

interface WelcomePageProps {
  isDark: boolean;
  onEnter: () => void;
}

const TIPS = [
  'Use "lex <file.l>" to compile with the browser interpreter',
  'Use "flex <file.l>" to compile with real Flex + GCC on the server',
  'Press Ctrl+S to save, Ctrl+B to toggle sidebar, Ctrl+` for terminal',
  'Right-click files in Explorer for rename/delete options',
  'Use "run <file.l>" for a quick compile + run workflow',
  'The "cat" command displays file contents in the terminal',
  'Type "help" in the terminal for all available commands',
];

export default function WelcomePage({ isDark, onEnter }: WelcomePageProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex(i => (i + 1) % TIPS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleEnter();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnter = () => {
    setExiting(true);
    setTimeout(onEnter, 400);
  };

  const bg = isDark ? 'bg-[#1e1e1e]' : 'bg-[#fafafa]';
  const textPrimary = isDark ? 'text-[#d4d4d4]' : 'text-[#333333]';
  const textSecondary = isDark ? 'text-[#858585]' : 'text-[#999999]';
  const textMuted = isDark ? 'text-[#555555]' : 'text-[#cccccc]';
  const accent = 'text-[#007acc]';
  const cardBg = isDark ? 'bg-[#252526]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#3c3c3c]' : 'border-[#e0e0e0]';
  const codeBg = isDark ? 'bg-[#1e1e1e]' : 'bg-[#f5f5f5]';

  return (
    <div
      className={`fixed inset-0 z-[100] ${bg} flex flex-col items-center justify-center overflow-hidden transition-opacity duration-400 ${
        exiting ? 'opacity-0 scale-105' : visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
      style={{ transitionProperty: 'opacity, transform', fontFamily: "'Segoe UI', -apple-system, sans-serif" }}
    >
      {/* Decorative background grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute inset-0 ${textMuted}`} style={{
          backgroundImage: isDark
            ? 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)'
            : 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.03) 1px, transparent 0)',
          backgroundSize: '32px 32px'
        }} />
      </div>

      {/* Content */}
      <div className={`relative z-10 flex flex-col items-center max-w-xl px-8 transition-all duration-700 ${
        visible && !exiting ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}>

        {/* Logo */}
        <div className="relative mb-6">
          <div className="absolute inset-0 blur-2xl opacity-30 bg-[#007acc] rounded-full scale-150" />
          <svg className="relative w-20 h-20 text-[#007acc] drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13.5 2L3 14h6.5L10 22l10.5-12H14L13.5 2z" />
          </svg>
        </div>

        {/* Title */}
        <h1 className={`text-4xl font-bold tracking-tight mb-1 ${textPrimary}`}>
          Lex Studio
        </h1>
        <p className={`text-sm mb-8 ${textSecondary}`}>
          Professional Lex/Flex IDE &mdash; Compile &amp; Run in your browser
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-3 gap-3 mb-8 w-full" style={{ transitionDelay: '200ms' }}>
          {[
            { icon: '⚡', title: 'Flex + GCC', desc: 'Real server-side compilation' },
            { icon: '🖥️', title: 'Monaco Editor', desc: 'VS Code editing experience' },
            { icon: '💻', title: 'Terminal', desc: 'Full CLI workflow' },
          ].map(card => (
            <div key={card.title} className={`${cardBg} ${cardBorder} border rounded-lg p-3 text-center`}>
              <div className="text-xl mb-1">{card.icon}</div>
              <div className={`text-xs font-semibold mb-0.5 ${textPrimary}`}>{card.title}</div>
              <div className={`text-[10px] ${textSecondary}`}>{card.desc}</div>
            </div>
          ))}
        </div>

        {/* Quick start code block */}
        <div className={`w-full ${codeBg} rounded-lg p-4 mb-8 border ${cardBorder}`}
          style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace" }}>
          <div className={`text-[10px] uppercase tracking-wider mb-2 ${textSecondary}`}>Quick Start</div>
          <div className="text-xs leading-6">
            <span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span>
            <span className={`ml-2 ${textPrimary}`}>lex scanner.l</span>
            <span className={`ml-3 ${textSecondary}`}>{'# compile'}</span>
            <br />
            <span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span>
            <span className={`ml-2 ${textPrimary}`}>gcc lex.yy.c -o scanner</span>
            <span className={`ml-3 ${textSecondary}`}>{'# link'}</span>
            <br />
            <span className={isDark ? 'text-[#4ec9b0]' : 'text-[#22863a]'}>$</span>
            <span className={`ml-2 ${textPrimary}`}>./scanner</span>
            <span className={`ml-3 ${textSecondary}`}>{'# run'}</span>
          </div>
        </div>

        {/* Tip */}
        <div className={`text-xs ${textSecondary} mb-8 h-5 transition-opacity duration-300`}>
          💡 {TIPS[tipIndex]}
        </div>

        {/* Enter button */}
        <button
          onClick={handleEnter}
          className={`group px-8 py-2.5 rounded-lg font-medium text-sm text-white bg-[#007acc] hover:bg-[#006bb3] active:scale-[0.97] transition-all duration-200 shadow-lg shadow-[#007acc]/20`}
        >
          Open Editor
          <span className="ml-2 opacity-60 text-xs">↵</span>
        </button>

        <p className={`text-[10px] mt-3 ${textMuted}`}>
          Press Enter or Space to continue
        </p>
      </div>

      {/* Version tag */}
      <div className={`absolute bottom-4 text-[10px] ${textMuted}`}>
        Lex Studio v1.0 &mdash; Powered by Flex, GCC &amp; Monaco
      </div>
    </div>
  );
}
