
import React from 'react';
import { TranscriptionEntry, GroundingSource } from '../types';

interface TranscriptionListProps {
  entries: TranscriptionEntry[];
  groundingSources: GroundingSource[];
}

const TranscriptionList: React.FC<TranscriptionListProps> = ({ entries, groundingSources }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="flex flex-col h-full">
      <div 
        ref={scrollRef}
        className="flex-grow overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        {entries.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center px-8">
            <svg className="w-12 h-12 mb-4 opacity-20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <p>Start a session to begin your research journey.</p>
            <p className="text-sm mt-2">I can search the web and answer your voice queries in real-time.</p>
          </div>
        )}
        {entries.map((entry) => (
          <div 
            key={entry.id}
            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] rounded-2xl p-4 ${
              entry.role === 'user' 
                ? 'accent-gradient text-white rounded-br-none' 
                : 'glass-morphism text-gray-100 rounded-bl-none'
            }`}>
              <div className="text-xs opacity-60 mb-1 font-semibold uppercase tracking-wider">
                {entry.role === 'user' ? 'You' : 'Gemini Assistant'}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.text}</p>
              <div className="text-[10px] opacity-40 mt-2 text-right">
                {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {groundingSources.length > 0 && (
        <div className="border-t border-white/10 p-4 glass-morphism">
          <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Research Sources</h3>
          <div className="flex flex-wrap gap-2">
            {groundingSources.map((source, idx) => (
              <a 
                key={idx}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-500/30 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {source.title.length > 30 ? source.title.substring(0, 30) + '...' : source.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptionList;
