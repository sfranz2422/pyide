"""gpiozero for PyIDE's simulated Raspberry Pi.

The calls are the real library's (gpiozero 1.4, what Raspbian Jessie has,
and the API the Beginner's Guide teaches), so a program written here runs on
a classroom Pi unchanged. What's underneath is not: a pin is a pin on the
breadboard the student wired on the page (pi_circuit.js says what a circuit
does), and the page is asked through window.PyIDEPi (pi.js).

Pins are BCM numbers, as gpiozero's are: LED(25) is GPIO 25, physical pin 22.
"GPIO25", "BCM25" and "BOARD22" work too.

Callbacks (when_pressed, when_released, when_held) run on the program's own
thread at its next turn — a time.sleep, another gpiozero call, or the loop
guard — where a real Pi runs them on a background thread at about the same
moment. A program that sets a callback and reaches its last line keeps
running, as it does in Thonny, until Stop (or os._exit) ends it.
"""
import inspect
import time

import _pyide_pi as _turns

__all__ = [
    "Device", "GPIODevice", "OutputDevice", "DigitalOutputDevice", "PWMOutputDevice",
    "LED", "PWMLED", "Buzzer", "InputDevice", "DigitalInputDevice", "Button",
    "LEDBoard", "TrafficLights", "GPIOZeroError", "GPIOPinInUse", "PinInvalidPin",
    "BadPinFactory",
]


class GPIOZeroError(Exception):
    pass


class GPIOPinInUse(GPIOZeroError):
    pass


class PinInvalidPin(GPIOZeroError, ValueError):
    pass


class BadPinFactory(GPIOZeroError):
    pass


class GPIODeviceClosed(GPIOZeroError):
    pass


_in_use = {}       # BCM number -> the device using it


def _bcm(pin):
    """A pin as gpiozero accepts it -> its BCM number."""
    if isinstance(pin, bool):
        raise PinInvalidPin("%r is not a valid pin" % (pin,))
    if isinstance(pin, int):
        number = pin
    elif isinstance(pin, str):
        text = pin.strip().upper().replace(" ", "")
        if text.startswith("BOARD"):
            number = _turns.pi().boardToBcm(int(text[5:]))
            if number is None or number < 0:
                raise PinInvalidPin("%s is not a GPIO pin (it's 3V3, 5V or GND)" % pin)
        else:
            for prefix in ("GPIO", "BCM"):
                if text.startswith(prefix):
                    text = text[len(prefix):]
            try:
                number = int(text)
            except ValueError:
                raise PinInvalidPin("%r is not a valid pin" % (pin,))
    elif isinstance(pin, Pin):
        number = pin.number
    else:
        raise PinInvalidPin("%r is not a valid pin" % (pin,))
    if not (2 <= number <= 27):
        raise PinInvalidPin("GPIO%d isn't a pin you can use on a Raspberry Pi 3 (they are GPIO2 to GPIO27)" % number)
    return number


class Pin(object):
    """What device.pin is: its number is the BCM number (the book's
    `button.pin.number == 14`)."""

    def __init__(self, number):
        self.number = number

    def __repr__(self):
        return "GPIO%d" % self.number

    __str__ = __repr__

    def __eq__(self, other):
        return isinstance(other, Pin) and other.number == self.number

    def __hash__(self):
        return hash(self.number)


class Device(object):
    def __init__(self):
        self._closed = False

    def close(self):
        self._closed = True

    @property
    def closed(self):
        return self._closed

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def is_active(self):
        return bool(self.value)

    def _check_open(self):
        if self._closed:
            raise GPIODeviceClosed("%s is closed or uninitialized" % self.__class__.__name__)


class GPIODevice(Device):
    def __init__(self, pin=None):
        super(GPIODevice, self).__init__()
        if pin is None:
            raise GPIOZeroError("No pin given")
        number = _bcm(pin)
        if number in _in_use and not _in_use[number].closed:
            raise GPIOPinInUse("pin GPIO%d is already in use by %r" % (number, _in_use[number]))
        _in_use[number] = self
        self._pin = Pin(number)

    @property
    def pin(self):
        return self._pin

    def close(self):
        if not self._closed and _in_use.get(self._pin.number) is self:
            del _in_use[self._pin.number]
            _turns.pi().gpioRelease(self._pin.number)
        super(GPIODevice, self).close()

    def __repr__(self):
        if self._closed:
            return "<gpiozero.%s object closed>" % self.__class__.__name__
        return "<gpiozero.%s object on pin %r, %s>" % (
            self.__class__.__name__, self._pin, self._state_words())

    def _state_words(self):
        return "is_active=%s" % self.is_active


# --------------------------------------------------------------- outputs

class OutputDevice(GPIODevice):
    def __init__(self, pin=None, active_high=True, initial_value=False, pin_factory=None):
        super(OutputDevice, self).__init__(pin)
        self._active_high = bool(active_high)
        _turns.pi().gpioSetup(self._pin.number, "out")
        self._write(1 if initial_value else 0)

    def _write(self, value):
        self._check_open()
        level = value if self._active_high else 1 - value
        _turns.pi().gpioWrite(self._pin.number, float(level))
        _turns.breathe()

    def on(self):
        self._stop_blink()
        self._write(1)

    def off(self):
        self._stop_blink()
        self._write(0)

    def toggle(self):
        self.value = 0 if self.value else 1

    @property
    def value(self):
        self._check_open()
        level = float(_turns.pi().gpioValue(self._pin.number))
        level = level if self._active_high else 1 - level
        return int(level > 0) if not isinstance(self, PWMOutputDevice) else level

    @value.setter
    def value(self, value):
        self._stop_blink()
        self._write(1 if value else 0)

    @property
    def active_high(self):
        return self._active_high

    def _stop_blink(self):
        _turns.pi().gpioStopBlink(self._pin.number)


class DigitalOutputDevice(OutputDevice):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
        """Blinks on the page's clock, so the LED keeps blinking while the
        program sleeps or waits — as gpiozero's background thread does."""
        self._check_open()
        _turns.pi().gpioBlink(self._pin.number, float(on_time) * 1000, float(off_time) * 1000,
                              -1 if n is None else int(n), 0, 0, 1)
        if not background:
            _turns.wait_until(lambda: not _turns.pi().gpioBlinking(self._pin.number))


class LED(DigitalOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class Buzzer(DigitalOutputDevice):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self.blink(on_time, off_time, n, background)


class PWMOutputDevice(OutputDevice):
    def __init__(self, pin=None, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        GPIODevice.__init__(self, pin)
        self._active_high = bool(active_high)
        self.frequency = frequency
        _turns.pi().gpioSetup(self._pin.number, "out")
        self._write(float(initial_value))

    @property
    def value(self):
        self._check_open()
        level = float(_turns.pi().gpioValue(self._pin.number))
        return level if self._active_high else 1 - level

    @value.setter
    def value(self, value):
        value = float(value)
        if not 0 <= value <= 1:
            raise ValueError("PWM value must be between 0 and 1")
        self._stop_blink()
        self._write(value)

    def toggle(self):
        self.value = 1 - self.value

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        self._check_open()
        _turns.pi().gpioBlink(self._pin.number, float(on_time) * 1000, float(off_time) * 1000,
                              -1 if n is None else int(n), float(fade_in_time) * 1000,
                              float(fade_out_time) * 1000, 1)
        if not background:
            _turns.wait_until(lambda: not _turns.pi().gpioBlinking(self._pin.number))

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, n, background)


class PWMLED(PWMOutputDevice):
    @property
    def is_lit(self):
        return self.value > 0


# ---------------------------------------------------------------- inputs

def _callback(f, device):
    """gpiozero calls a callback with the device if it takes one argument
    (the book's `def pressed(button):`), and with nothing if it takes none."""
    if f is None:
        return None
    if not callable(f):
        raise BadCallback("value must be None or a callable")
    try:
        params = [p for p in inspect.signature(f).parameters.values()
                  if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
        wants = len(params)
    except (TypeError, ValueError):
        wants = 0
    if wants == 0:
        return lambda: f()
    if wants == 1:
        return lambda: f(device)
    raise BadCallback("value must be a callable which accepts up to one mandatory parameter")


class BadCallback(GPIOZeroError, TypeError):
    pass


class InputDevice(GPIODevice):
    def __init__(self, pin=None, pull_up=False, pin_factory=None):
        super(InputDevice, self).__init__(pin)
        self._pull_up = pull_up
        _turns.pi().gpioSetup(self._pin.number, "in", "up" if pull_up else "down")

    @property
    def pull_up(self):
        return self._pull_up

    def _level(self):
        self._check_open()
        _turns.breathe()
        return int(_turns.pi().gpioRead(self._pin.number))

    @property
    def value(self):
        level = self._level()
        return int(not level) if self._pull_up else level


class DigitalInputDevice(InputDevice):
    def __init__(self, pin=None, pull_up=False, bounce_time=None, pin_factory=None):
        super(DigitalInputDevice, self).__init__(pin, pull_up)
        self._when_activated = None
        self._when_deactivated = None
        self._edges = self._count()
        self._active_since = None
        _turns.after_turn(self._poll)

    def _count(self):
        """How many times the pin has become active, and inactive, so far
        (counted by the page, so a press and release inside one sleep
        is still one press)."""
        e = _turns.pi().gpioEdges(self._pin.number)
        rises, falls = int(e[0]), int(e[1])
        # Pulled up: pressing pulls the pin low, so a fall is an activation.
        return (falls, rises) if self._pull_up else (rises, falls)

    def _poll(self):
        if self._closed:
            return
        now = self._count()
        on, off = now[0] - self._edges[0], now[1] - self._edges[1]
        self._edges = now
        if self.is_active:
            if self._active_since is None:
                self._active_since = time.monotonic()
        else:
            self._active_since = None
        # Each press, then each release, in order, as they happened.
        for _ in range(max(on, off)):
            if on > 0:
                on -= 1
                if self._when_activated:
                    self._when_activated()
            if off > 0:
                off -= 1
                if self._when_deactivated:
                    self._when_deactivated()

    def wait_for_active(self, timeout=None):
        start = self._count()[0]
        return _turns.wait_until(lambda: self._count()[0] > start or self.is_active, timeout)

    def wait_for_inactive(self, timeout=None):
        start = self._count()[1]
        return _turns.wait_until(lambda: self._count()[1] > start or not self.is_active, timeout)

    @property
    def when_activated(self):
        return self._when_activated

    @when_activated.setter
    def when_activated(self, f):
        self._when_activated = _callback(f, self)
        _turns.keep_alive(self, self._when_activated is not None or self._when_deactivated is not None)

    @property
    def when_deactivated(self):
        return self._when_deactivated

    @when_deactivated.setter
    def when_deactivated(self, f):
        self._when_deactivated = _callback(f, self)
        _turns.keep_alive(self, self._when_activated is not None or self._when_deactivated is not None)

    def close(self):
        _turns.keep_alive(self, False)
        super(DigitalInputDevice, self).close()


class Button(DigitalInputDevice):
    def __init__(self, pin=None, pull_up=True, bounce_time=None, hold_time=1, hold_repeat=False,
                 pin_factory=None):
        super(Button, self).__init__(pin, pull_up, bounce_time)
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat
        self._when_held = None
        self._held_fired = False

    @property
    def is_pressed(self):
        return self.is_active

    @property
    def is_held(self):
        return self._active_since is not None and time.monotonic() - self._active_since >= self.hold_time

    @property
    def held_time(self):
        return None if self._active_since is None else time.monotonic() - self._active_since

    def wait_for_press(self, timeout=None):
        return self.wait_for_active(timeout)

    def wait_for_release(self, timeout=None):
        return self.wait_for_inactive(timeout)

    when_pressed = DigitalInputDevice.when_activated
    when_released = DigitalInputDevice.when_deactivated

    @property
    def when_held(self):
        return self._when_held

    @when_held.setter
    def when_held(self, f):
        self._when_held = _callback(f, self)
        _turns.keep_alive(self, True if f else (self._when_activated is not None or self._when_deactivated is not None))

    def _poll(self):
        super(Button, self)._poll()
        if self._active_since is None:
            self._held_fired = False
        elif self._when_held and self.is_held and not self._held_fired:
            self._held_fired = not self.hold_repeat
            if self.hold_repeat:
                self._active_since = time.monotonic()
            self._when_held()

    def _state_words(self):
        return "pull_up=%s, is_active=%s" % (self._pull_up, self.is_active)


# ----------------------------------------------------------------- boards

class LEDBoard(Device):
    def __init__(self, *pins, **kwargs):
        super(LEDBoard, self).__init__()
        pwm = kwargs.pop("pwm", False)
        names = kwargs.pop("_order", None)
        cls = PWMLED if pwm else LED
        self.leds = tuple(cls(p) for p in pins)
        named = []
        for name in (names or []):
            if name in kwargs and kwargs[name] is not None:
                led = cls(kwargs.pop(name))
                setattr(self, name, led)
                named.append(led)
        self.leds = self.leds + tuple(named)

    def on(self):
        for led in self.leds:
            led.on()

    def off(self):
        for led in self.leds:
            led.off()

    def toggle(self):
        for led in self.leds:
            led.toggle()

    def blink(self, on_time=1, off_time=1, n=None, background=True):
        for led in self.leds:
            led.blink(on_time, off_time, n, True)
        if not background:
            _turns.wait_until(lambda: not any(_turns.pi().gpioBlinking(l.pin.number) for l in self.leds))

    @property
    def value(self):
        return tuple(led.value for led in self.leds)

    @value.setter
    def value(self, values):
        for led, v in zip(self.leds, values):
            led.value = v

    def close(self):
        for led in self.leds:
            led.close()
        super(LEDBoard, self).close()

    def __iter__(self):
        return iter(self.leds)

    def __len__(self):
        return len(self.leds)

    def __getitem__(self, i):
        return self.leds[i]


class TrafficLights(LEDBoard):
    def __init__(self, red=None, amber=None, green=None, pwm=False, initial_value=False,
                 yellow=None, pin_factory=None):
        if amber is not None and yellow is not None:
            raise GPIOZeroError("Only one of amber or yellow can be specified")
        middle = "yellow" if yellow is not None else "amber"
        kwargs = {"red": red, middle: yellow if yellow is not None else amber, "green": green}
        if any(v is None for v in kwargs.values()):
            raise GPIOZeroError("Three pins are needed: red, amber (or yellow) and green")
        super(TrafficLights, self).__init__(pwm=pwm, _order=["red", middle, "green"], **kwargs)
        if middle == "yellow":
            self.amber = self.yellow
        else:
            self.yellow = self.amber
