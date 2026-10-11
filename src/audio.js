/**
 * Процедурні звуки (Web Audio API) — жодних аудіофайлів.
 * Шари: вітер, низький гул, цвіркуни, скрип дверей, дзижчання ліхтаря.
 * AudioContext можна створити лише після дії користувача, тому startAudio() викликається по кліку.
 */
let ctx = null
let master = null
let windGain = null
let droneGain = null
let cricketGain = null
let buzzGain = null
let cricketTimer = null

export const audioState = {
    started: false,
    muted: false,
    volume: 0.7,
    wind: 0.5,
    drone: 0.5,
    crickets: 0.4
}

const makeNoiseBuffer = () =>
{
    const length = ctx.sampleRate * 4
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for(let i = 0; i < length; i++)
    {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02 // коричневий шум — м'якший за білий
        data[i] = last * 3.5
    }
    return buffer
}

const chirp = () =>
{
    if(!ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    const pulses = 2 + Math.floor(Math.random() * 3)
    const base = 3800 + Math.random() * 700
    for(let i = 0; i < pulses; i++)
    {
        const osc = ctx.createOscillator()
        const env = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = base
        const t = now + i * 0.085
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(0.05, t + 0.012)
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
        osc.connect(env).connect(cricketGain)
        osc.start(t)
        osc.stop(t + 0.08)
    }
}

const scheduleCrickets = () =>
{
    chirp()
    cricketTimer = setTimeout(scheduleCrickets, 700 + Math.random() * 2600)
}

export const startAudio = () =>
{
    if(audioState.started)
    {
        ctx.resume()
        return
    }

    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = audioState.muted ? 0 : audioState.volume
    master.connect(ctx.destination)

    const noise = makeNoiseBuffer()

    // Вітер: шум → смуговий фільтр, частота й гучність «дихають» двома LFO
    const windSource = ctx.createBufferSource()
    windSource.buffer = noise
    windSource.loop = true
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 420
    windFilter.Q.value = 0.9
    windGain = ctx.createGain()
    windGain.gain.value = audioState.wind * 0.9

    const lfo1 = ctx.createOscillator()
    lfo1.frequency.value = 0.11
    const lfo1Amount = ctx.createGain()
    lfo1Amount.gain.value = 260
    lfo1.connect(lfo1Amount).connect(windFilter.frequency)
    lfo1.start()

    const lfo2 = ctx.createOscillator()
    lfo2.frequency.value = 0.07
    const lfo2Amount = ctx.createGain()
    lfo2Amount.gain.value = 0.25
    lfo2.connect(lfo2Amount).connect(windGain.gain)
    lfo2.start()

    windSource.connect(windFilter).connect(windGain).connect(master)
    windSource.start()

    // Гул: дві пилкоподібні хвилі з легкою розстройкою → «биття»
    droneGain = ctx.createGain()
    droneGain.gain.value = audioState.drone * 0.12
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 170
    for(const f of [48, 48.7, 72.3])
    {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = f
        osc.connect(droneFilter)
        osc.start()
    }
    droneFilter.connect(droneGain).connect(master)

    // Цвіркуни
    cricketGain = ctx.createGain()
    cricketGain.gain.value = audioState.crickets
    cricketGain.connect(master)

    // Дзижчання ліхтаря (гучність керується миготінням)
    buzzGain = ctx.createGain()
    buzzGain.gain.value = 0
    const buzzFilter = ctx.createBiquadFilter()
    buzzFilter.type = 'bandpass'
    buzzFilter.frequency.value = 1400
    buzzFilter.Q.value = 3
    const buzzOsc = ctx.createOscillator()
    buzzOsc.type = 'sawtooth'
    buzzOsc.frequency.value = 100
    buzzOsc.connect(buzzFilter).connect(buzzGain).connect(master)
    buzzOsc.start()

    audioState.started = true
    scheduleCrickets()
}

export const setMasterVolume = (v) =>
{
    audioState.volume = v
    if(master) master.gain.setTargetAtTime(audioState.muted ? 0 : v, ctx.currentTime, 0.05)
}

export const setMuted = (muted) =>
{
    audioState.muted = muted
    if(master) master.gain.setTargetAtTime(muted ? 0 : audioState.volume, ctx.currentTime, 0.05)
}

export const setLayer = (name, v) =>
{
    audioState[name] = v
    if(!ctx) return
    const t = ctx.currentTime
    if(name === 'wind') windGain.gain.setTargetAtTime(v * 0.9, t, 0.05)
    if(name === 'drone') droneGain.gain.setTargetAtTime(v * 0.12, t, 0.05)
    if(name === 'crickets') cricketGain.gain.setTargetAtTime(v, t, 0.05)
}

// level: 0..1 — наскільки сильно зараз «збоїть» ліхтар
export const setBuzz = (level) =>
{
    if(!ctx || !buzzGain) return
    buzzGain.gain.setTargetAtTime(level * 0.035, ctx.currentTime, 0.03)
}

export const creak = () =>
{
    if(!ctx || ctx.state !== 'running' || audioState.muted) return
    const now = ctx.currentTime
    const dur = 0.9 + Math.random() * 0.5
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(110 + Math.random() * 60, now)
    osc.frequency.linearRampToValueAtTime(70 + Math.random() * 30, now + dur)

    const vibrato = ctx.createOscillator()
    vibrato.frequency.value = 11
    const vibratoAmount = ctx.createGain()
    vibratoAmount.gain.value = 14
    vibrato.connect(vibratoAmount).connect(osc.frequency)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(500, now)
    filter.frequency.linearRampToValueAtTime(900, now + dur)
    filter.Q.value = 7

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(0.16, now + 0.15)
    env.gain.linearRampToValueAtTime(0.1, now + dur * 0.6)
    env.gain.linearRampToValueAtTime(0, now + dur)

    osc.connect(filter).connect(env).connect(master)
    osc.start(now)
    vibrato.start(now)
    osc.stop(now + dur + 0.05)
    vibrato.stop(now + dur + 0.05)
}
