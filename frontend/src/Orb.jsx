import React, {useEffect, useRef} from 'react';
import './orb.css';

// La misma esfera en la barra y en la conversación. Sin canvas ni bucles JS.
export default function Orb({className = '', state = 'idle', level = 0}) {
  const ref = useRef(null);
  useEffect(() => {
    const update = () => { if (ref.current) ref.current.dataset.paused = String(document.hidden); };
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <span ref={ref} className={`orb-visual ${className}`} data-state={state} style={{'--level': level}} aria-hidden="true">
    <span className="orb-rings"><i/><i/><i/></span>
    <span className="orb-core"><span className="orb-wave a"/><span className="orb-wave b"/><span className="orb-swirl"/><span className="orb-shine"/>
      <span className="orb-dust">{Array.from({length: 14}, (_, i) => <i key={i} style={{'--x': `${12 + (i * 23) % 77}%`, '--y': `${10 + (i * 37) % 79}%`, '--delay': `${-i * .71}s`, '--duration': `${5 + i % 5}s`}}/>)}</span>
    </span>
    <span className="orb-satellites"><i/><i/><i/></span>
  </span>;
}
