(() => {
  const storageKey = 'mtSnakeSoundEnabled';
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let enabled = true;

  try {
    enabled = localStorage.getItem(storageKey) !== 'false';
  } catch (error) {
    enabled = true;
    console.warn('Sound preference could not be loaded; sound is enabled for this session.', error);
  }

  const sounds = {
    click: [{ frequency: 620, duration: 0.055, type: 'sine', volume: 0.055 }],
    collect: [
      { frequency: 660, duration: 0.09, type: 'sine', volume: 0.08 },
      { frequency: 990, duration: 0.12, type: 'sine', volume: 0.07, delay: 0.07 }
    ],
    powerup: [
      { frequency: 440, duration: 0.12, type: 'triangle', volume: 0.075 },
      { frequency: 660, duration: 0.12, type: 'triangle', volume: 0.075, delay: 0.09 },
      { frequency: 880, duration: 0.18, type: 'triangle', volume: 0.075, delay: 0.18 }
    ],
    death: [
      { frequency: 310, duration: 0.16, type: 'sawtooth', volume: 0.055 },
      { frequency: 190, duration: 0.28, type: 'triangle', volume: 0.075, delay: 0.12 }
    ],
    knockout: [{ frequency: 260, duration: 0.16, type: 'triangle', volume: 0.045 }],
    respawn: [
      { frequency: 390, duration: 0.1, type: 'sine', volume: 0.06 },
      { frequency: 590, duration: 0.16, type: 'sine', volume: 0.06, delay: 0.08 }
    ],
    start: [
      { frequency: 440, duration: 0.13, type: 'triangle', volume: 0.065 },
      { frequency: 587, duration: 0.13, type: 'triangle', volume: 0.065, delay: 0.11 },
      { frequency: 784, duration: 0.22, type: 'triangle', volume: 0.07, delay: 0.22 }
    ],
    end: [
      { frequency: 587, duration: 0.16, type: 'sine', volume: 0.065 },
      { frequency: 440, duration: 0.2, type: 'sine', volume: 0.06, delay: 0.14 }
    ],
    toggle: [{ frequency: 740, duration: 0.08, type: 'sine', volume: 0.06 }]
  };

  function getContext() {
    if (!enabled) return null;
    if (!AudioContextClass) {
      console.warn('Web Audio is not supported; sound effects are unavailable.');
      return null;
    }
    if (!context) context = new AudioContextClass();
    if (context.state === 'suspended') {
      context.resume().catch((error) => {
        console.warn('Audio could not be resumed.', error);
      });
    }
    return context;
  }

  function play(name) {
    if (!enabled || !sounds[name]) return;
    const audioContext = getContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    sounds[name].forEach((note) => {
      const start = now + (note.delay || 0);
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + note.duration + 0.01);
    });
  }

  function updateToggle() {
    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      const icon = button.querySelector('.sound-icon');
      const label = button.querySelector('.sound-label');
      if (icon) icon.textContent = enabled ? '🔊' : '🔇';
      if (label) label.textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
      button.setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound');
      button.setAttribute('aria-pressed', String(!enabled));
      button.classList.toggle('is-muted', !enabled);
    });
  }

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-sound-toggle]');
    if (toggle) {
      enabled = !enabled;
      try {
        localStorage.setItem(storageKey, String(enabled));
      } catch (error) {
        console.warn('Sound preference could not be saved.', error);
      }
      updateToggle();
      if (enabled) play('toggle');
      return;
    }

    const button = event.target.closest('button');
    if (button && !button.disabled) play('click');
  }, true);

  updateToggle();
  window.AudioFX = { play };
})();
