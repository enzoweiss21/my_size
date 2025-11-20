import React from 'react';

export default function ModeSelector({ onSelectMode }) {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      padding: '20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <h1 style={{ color: 'white', marginBottom: '40px', fontSize: '32px', fontWeight: 'bold' }}>
        Body Measurement App
      </h1>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => onSelectMode('pose')}
          style={{
            padding: '20px 40px',
            fontSize: '18px',
            fontWeight: 'bold',
            background: 'white',
            color: '#667eea',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
        >
          📐 Pose Estimation Mode
        </button>
        
        <button
          onClick={() => onSelectMode('manual')}
          style={{
            padding: '20px 40px',
            fontSize: '18px',
            fontWeight: 'bold',
            background: 'white',
            color: '#764ba2',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
        >
          ✏️ Manual Drawing Mode
        </button>
      </div>
      
      <p style={{ color: 'white', marginTop: '30px', opacity: 0.9, textAlign: 'center', maxWidth: '500px' }}>
        Choose a measurement mode. Pose Estimation uses AI to automatically detect body features, 
        while Manual Drawing lets you place measurement points yourself.
      </p>
    </div>
  );
}

