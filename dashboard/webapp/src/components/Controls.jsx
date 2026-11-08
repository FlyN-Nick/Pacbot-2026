import { useState, useEffect, useCallback, useRef } from 'react';
import { heldToCommand, mixMotors, directionLabel } from '../driveMix';
import './Controls.css';

// Keyboard key -> logical drive key. Held keys drive; releasing stops.
const KEY_MAP = {
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  q: 'ccw', e: 'cw',
};

const DIR_CODES = { stop: 0, north: 1, east: 2, south: 3, west: 4 };

const LABEL_TO_CARDINAL = {
  forward: 'north', backward: 'south', left: 'west', right: 'east',
};

// The firmware stops manual motors after 500 ms of silence, so resend while moving.
const RESEND_MS = 100;

// D-pad layout: [label, logical keys]. Diagonals hold two keys at once.
const PAD = [
  [['↖', ['up', 'left']], ['↑', ['up']], ['↗', ['up', 'right']]],
  [['←', ['left']], null, ['→', ['right']]],
  [['↙', ['down', 'left']], ['↓', ['down']], ['↘', ['down', 'right']]],
];

function isTextInput(el) {
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && el.type !== 'range';
}

// Logical keys -> the websocket message for the current mode.
function buildMessage(held, cardinalMode, speed) {
  const cmd = heldToCommand(held);
  if (cardinalMode) {
    // Cardinal mode only supports the four directions; diagonals and spin stop.
    const label = cmd.rot === 0 ? directionLabel(cmd) : null;
    const cardinal = LABEL_TO_CARDINAL[label] ?? 'stop';
    const code = DIR_CODES[cardinal];
    return {
      label: code === 0 ? null : label,
      moving: code !== 0 && speed > 0,
      msg: { type: "cardinal_move", direction: code, speed: code === 0 ? 0 : speed },
    };
  }
  const speeds = mixMotors(cmd, speed);
  return {
    label: directionLabel(cmd),
    moving: speeds.some(s => s !== 0),
    msg: { type: "set_motors", speeds },
  };
}

export default function Controls({ onDirectionChange, send }) {
  const [speed, setSpeed] = useState(128);
  const [cardinalMode, setCardinalMode] = useState(false);
  const [held, setHeld] = useState(() => new Set());
  const wasMovingRef = useRef(false);

  const press = useCallback((keys) => {
    setHeld(prev => {
      if (keys.every(k => prev.has(k))) return prev;
      return new Set([...prev, ...keys]);
    });
  }, []);

  const release = useCallback((keys) => {
    setHeld(prev => {
      if (!keys.some(k => prev.has(k))) return prev;
      const next = new Set(prev);
      keys.forEach(k => next.delete(k));
      return next;
    });
  }, []);

  // Send on every change, then keep resending while moving.
  useEffect(() => {
    const { label, moving, msg } = buildMessage(held, cardinalMode, speed);
    onDirectionChange(label);
    if (moving || wasMovingRef.current) send(msg);
    wasMovingRef.current = moving;
    if (!moving) return;
    const id = setInterval(() => send(msg), RESEND_MS);
    return () => clearInterval(id);
  }, [held, cardinalMode, speed, send, onDirectionChange]);

  const stop = useCallback(() => {
    setHeld(new Set());
    send(cardinalMode
      ? { type: "cardinal_move", direction: 0, speed: 0 }
      : { type: "set_motors", speeds: [0, 0, 0, 0] });
  }, [send, cardinalMode]);

  const toggleMode = useCallback(() => {
    const newMode = !cardinalMode;
    setHeld(new Set());
    setCardinalMode(newMode);
    send({ type: "set_drive_mode", mode: newMode ? 1 : 0 });
  }, [cardinalMode, send]);

  const calibrate = useCallback(() => {
    send({ type: "calibrate" });
  }, [send]);

  useEffect(() => {
    function onKeyDown(e) {
      if (isTextInput(e.target)) return;
      const key = e.key.toLowerCase();
      const logical = KEY_MAP[key];
      if (logical) {
        e.preventDefault();
        press([logical]);
        return;
      }
      if (e.repeat) return;
      switch (key) {
        case " ":
        case "x": e.preventDefault(); stop(); break;
        case "m": toggleMode(); break;
        case "+":
        case "=": setSpeed(prev => Math.min(255, prev + 10)); break;
        case "-": setSpeed(prev => Math.max(0, prev - 10)); break;
      }
    }
    function onKeyUp(e) {
      const logical = KEY_MAP[e.key.toLowerCase()];
      if (logical) release([logical]);
    }
    // Keyups are lost when the window loses focus, so stop instead.
    function onBlur() { setHeld(new Set()); }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [press, release, stop, toggleMode]);

  // Buttons drive while pressed, like the keys.
  const holdProps = (keys) => ({
    className: keys.every(k => held.has(k)) ? "active" : "",
    onPointerDown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); press(keys); },
    onPointerUp: () => release(keys),
    onPointerCancel: () => release(keys),
  });

  const isDiagonal = (keys) => keys.length > 1;

  return (
    <div className="panel controls-panel">
      <h2>MOTOR CONTROLS</h2>
      <div className="mode-row">
        <button
          className={`mode-btn ${!cardinalMode ? 'active' : ''}`}
          onClick={cardinalMode ? toggleMode : undefined}
        >
          MANUAL
        </button>
        <button
          className={`mode-btn ${cardinalMode ? 'active' : ''}`}
          onClick={!cardinalMode ? toggleMode : undefined}
        >
          CARDINAL
        </button>
        <button className="cmd-btn calibrate-btn" onClick={calibrate}>
          CALIBRATE
        </button>
      </div>
      <div className="direction-controls">
        <div className="dpad">
          {PAD.map((row, r) => (
            <div className="dir-row" key={r}>
              {row.map((cell, c) => {
                if (!cell) {
                  return (
                    <button key={c} className={held.size === 0 ? "active" : ""} onClick={stop}>
                      STOP
                    </button>
                  );
                }
                const [label, keys] = cell;
                const disabled = cardinalMode && isDiagonal(keys);
                return (
                  <button key={c} disabled={disabled} {...holdProps(keys)}>
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="dir-row">
            <button className="rot-btn" disabled={cardinalMode} {...holdProps(['ccw'])}>
              Q &#8634;
            </button>
            <button className="rot-btn" disabled={cardinalMode} {...holdProps(['cw'])}>
              E &#8635;
            </button>
          </div>
        </div>
      </div>
      <p className="key-hint">
        Hold arrows/WASD to drive{cardinalMode ? '' : ', two at once for diagonals, Q/E to spin'}.
        Space stops. M switches mode.
      </p>
      <div className="sliders">
        <label>
          SPEED <span>{speed}</span>
          <input
            type="range" min="0" max="255" step="1"
            value={speed}
            onChange={(e) => setSpeed(parseInt(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
