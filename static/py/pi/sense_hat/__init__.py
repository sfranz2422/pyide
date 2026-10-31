"""sense_hat for PyIDE's simulated Raspberry Pi.

The calls are the real library's (sense-hat 2.2, what Raspbian Jessie has,
and what chapter 7 of the Beginner's Guide teaches), so a program written
here runs on a classroom Pi with a Sense HAT unchanged. Underneath, the LED
matrix, the sensors and the joystick are the panel on the page (pi.js), the
same as the official Sense HAT emulator: sliders for the readings, a stick
to push.

Things the real board does that a program can see, and so this does too:
  * a colour read back is what the LEDs can show (5 bits of red, 6 of
    green, 5 of blue), so set_pixel(0, 0, 255, 0, 0) reads back [248, 0, 0];
  * the LEDs keep showing whatever was last drawn after the program ends —
    sense.clear() is how a program turns them off;
  * a joystick callback runs for every event, pressed, released and held,
    and a function that takes no argument is called with none (the book's
    `sense.stick.direction_up = red`, and `direction_middle = sense.clear`).

Like gpiozero here, every call gives the page a turn (see _pyide_pi), and
show_message scrolls one column a turn, so the page keeps moving while it
does.
"""
import collections
import inspect
import json
import math
import time

import _pyide_pi as _turns

__all__ = ["SenseHat", "SenseStick", "InputEvent", "ACTION_PRESSED", "ACTION_RELEASED",
           "ACTION_HELD", "DIRECTION_UP", "DIRECTION_DOWN", "DIRECTION_LEFT",
           "DIRECTION_RIGHT", "DIRECTION_MIDDLE", "DIRECTION_ANY"]

ACTION_PRESSED = "pressed"
ACTION_RELEASED = "released"
ACTION_HELD = "held"
DIRECTION_UP = "up"
DIRECTION_DOWN = "down"
DIRECTION_LEFT = "left"
DIRECTION_RIGHT = "right"
DIRECTION_MIDDLE = "middle"
DIRECTION_ANY = "any"

InputEvent = collections.namedtuple("InputEvent", ("timestamp", "direction", "action"))


# ------------------------------------------------------------------ the font
# A 5x7 font, one byte a column, the lowest bit the top row: ASCII from
# space to ~. A character it hasn't is drawn as "?", as the real library
# does.
_FONT_CHARS = "".join(chr(c) for c in range(32, 127))
_FONT = [
    0x00, 0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x5F, 0x00, 0x00,  0x00, 0x07, 0x00, 0x07, 0x00,
    0x14, 0x7F, 0x14, 0x7F, 0x14,  0x24, 0x2A, 0x7F, 0x2A, 0x12,  0x23, 0x13, 0x08, 0x64, 0x62,
    0x36, 0x49, 0x56, 0x20, 0x50,  0x00, 0x00, 0x07, 0x00, 0x00,  0x00, 0x1C, 0x22, 0x41, 0x00,
    0x00, 0x41, 0x22, 0x1C, 0x00,  0x14, 0x08, 0x3E, 0x08, 0x14,  0x08, 0x08, 0x3E, 0x08, 0x08,
    0x00, 0x50, 0x30, 0x00, 0x00,  0x08, 0x08, 0x08, 0x08, 0x08,  0x00, 0x60, 0x60, 0x00, 0x00,
    0x20, 0x10, 0x08, 0x04, 0x02,  0x3E, 0x51, 0x49, 0x45, 0x3E,  0x00, 0x42, 0x7F, 0x40, 0x00,
    0x42, 0x61, 0x51, 0x49, 0x46,  0x21, 0x41, 0x45, 0x4B, 0x31,  0x18, 0x14, 0x12, 0x7F, 0x10,
    0x27, 0x45, 0x45, 0x45, 0x39,  0x3C, 0x4A, 0x49, 0x49, 0x30,  0x01, 0x71, 0x09, 0x05, 0x03,
    0x36, 0x49, 0x49, 0x49, 0x36,  0x06, 0x49, 0x49, 0x29, 0x1E,  0x00, 0x36, 0x36, 0x00, 0x00,
    0x00, 0x56, 0x36, 0x00, 0x00,  0x08, 0x14, 0x22, 0x41, 0x00,  0x14, 0x14, 0x14, 0x14, 0x14,
    0x00, 0x41, 0x22, 0x14, 0x08,  0x02, 0x01, 0x51, 0x09, 0x06,  0x32, 0x49, 0x79, 0x41, 0x3E,
    0x7E, 0x11, 0x11, 0x11, 0x7E,  0x7F, 0x49, 0x49, 0x49, 0x36,  0x3E, 0x41, 0x41, 0x41, 0x22,
    0x7F, 0x41, 0x41, 0x22, 0x1C,  0x7F, 0x49, 0x49, 0x49, 0x41,  0x7F, 0x09, 0x09, 0x09, 0x01,
    0x3E, 0x41, 0x49, 0x49, 0x7A,  0x7F, 0x08, 0x08, 0x08, 0x7F,  0x00, 0x41, 0x7F, 0x41, 0x00,
    0x20, 0x40, 0x41, 0x3F, 0x01,  0x7F, 0x08, 0x14, 0x22, 0x41,  0x7F, 0x40, 0x40, 0x40, 0x40,
    0x7F, 0x02, 0x0C, 0x02, 0x7F,  0x7F, 0x04, 0x08, 0x10, 0x7F,  0x3E, 0x41, 0x41, 0x41, 0x3E,
    0x7F, 0x09, 0x09, 0x09, 0x06,  0x3E, 0x41, 0x51, 0x21, 0x5E,  0x7F, 0x09, 0x19, 0x29, 0x46,
    0x46, 0x49, 0x49, 0x49, 0x31,  0x01, 0x01, 0x7F, 0x01, 0x01,  0x3F, 0x40, 0x40, 0x40, 0x3F,
    0x1F, 0x20, 0x40, 0x20, 0x1F,  0x3F, 0x40, 0x38, 0x40, 0x3F,  0x63, 0x14, 0x08, 0x14, 0x63,
    0x07, 0x08, 0x70, 0x08, 0x07,  0x61, 0x51, 0x49, 0x45, 0x43,  0x00, 0x7F, 0x41, 0x41, 0x00,
    0x02, 0x04, 0x08, 0x10, 0x20,  0x00, 0x41, 0x41, 0x7F, 0x00,  0x04, 0x02, 0x01, 0x02, 0x04,
    0x40, 0x40, 0x40, 0x40, 0x40,  0x00, 0x01, 0x02, 0x04, 0x00,  0x20, 0x54, 0x54, 0x54, 0x78,
    0x7F, 0x48, 0x44, 0x44, 0x38,  0x38, 0x44, 0x44, 0x44, 0x20,  0x38, 0x44, 0x44, 0x48, 0x7F,
    0x38, 0x54, 0x54, 0x54, 0x18,  0x08, 0x7E, 0x09, 0x01, 0x02,  0x0C, 0x52, 0x52, 0x52, 0x3E,
    0x7F, 0x08, 0x04, 0x04, 0x78,  0x00, 0x44, 0x7D, 0x40, 0x00,  0x20, 0x40, 0x44, 0x3D, 0x00,
    0x7F, 0x10, 0x28, 0x44, 0x00,  0x00, 0x41, 0x7F, 0x40, 0x00,  0x7C, 0x04, 0x18, 0x04, 0x78,
    0x7C, 0x08, 0x04, 0x04, 0x78,  0x38, 0x44, 0x44, 0x44, 0x38,  0x7C, 0x14, 0x14, 0x14, 0x08,
    0x08, 0x14, 0x14, 0x18, 0x7C,  0x7C, 0x08, 0x04, 0x04, 0x08,  0x48, 0x54, 0x54, 0x54, 0x20,
    0x04, 0x3F, 0x44, 0x40, 0x20,  0x3C, 0x40, 0x40, 0x20, 0x7C,  0x1C, 0x20, 0x40, 0x20, 0x1C,
    0x3C, 0x40, 0x30, 0x40, 0x3C,  0x44, 0x28, 0x10, 0x28, 0x44,  0x0C, 0x50, 0x50, 0x50, 0x3C,
    0x44, 0x64, 0x54, 0x4C, 0x44,  0x00, 0x08, 0x36, 0x41, 0x00,  0x00, 0x00, 0x7F, 0x00, 0x00,
    0x00, 0x41, 0x36, 0x08, 0x00,  0x10, 0x08, 0x08, 0x10, 0x08,
]


def _glyph(ch):
    """The character's five columns, each eight rows (top first) of True/False.
    Row 0 is left empty, so a letter sits in rows 1-7 as on the real board."""
    i = _FONT_CHARS.find(ch)
    if i < 0:
        i = _FONT_CHARS.find("?")
    cols = _FONT[i * 5:i * 5 + 5]
    return [[False] + [bool(c >> r & 1) for r in range(7)] for c in cols]


# ------------------------------------------------------------- the matrix
# Where logical pixel (x, y) lands on the board at each rotation: numpy's
# rot90 of the plain map, as the real library makes them.
def _maps():
    m0 = [[y * 8 + x for x in range(8)] for y in range(8)]

    def rot90(m):           # numpy.rot90: a quarter turn anticlockwise
        return [[m[x][7 - y] for x in range(8)] for y in range(8)]
    m90 = rot90(m0)
    m180 = rot90(m90)
    m270 = rot90(m180)
    return {0: m0, 90: m90, 180: m180, 270: m270}


_MAP = _maps()


def _pack(pixel):
    r, g, b = pixel
    return ((r >> 3) & 0x1F) << 11 | ((g >> 2) & 0x3F) << 5 | ((b >> 3) & 0x1F)


def _unpack(v):
    return [((v >> 11) & 0x1F) << 3, ((v >> 5) & 0x3F) << 2, (v & 0x1F) << 3]


# The LEDs outlive a SenseHat object and a run, as the real board's do, so
# they live here, in the page (pi.js), and not on the object. _fb is this
# run's copy; it starts as what the page shows.
_fb = [None]


def _framebuffer():
    if _fb[0] is None:
        text = str(_turns.pi().senseFramebuffer())
        _fb[0] = [int(text[i:i + 4], 16) for i in range(0, 256, 4)] if len(text) == 256 else [0] * 64
    return _fb[0]


def _show():
    _turns.pi().senseShow("".join("%04x" % v for v in _framebuffer()))
    _turns.breathe()


def _check_pixel(pixel, index=None):
    if not isinstance(pixel, (list, tuple)) or len(pixel) != 3:
        if index is None:
            raise ValueError("Pixel arguments must be given as (r, g, b) or r, g, b")
        raise ValueError("Pixel at index %d is invalid. Pixels must contain 3 elements: Red, Green and Blue" % index)
    for element in pixel:
        if element > 255 or element < 0:
            if index is None:
                raise ValueError("Pixel elements must be between 0 and 255")
            raise ValueError("Pixel at index %d is invalid. Pixel elements must be between 0 and 255" % index)
    return [int(e) for e in pixel]


# ------------------------------------------------------------ the joystick
def _wrap_callback(fn):
    """The real stick's rule: a function that can be called with nothing is
    called with nothing (the event dropped), else with the event."""
    if fn is None:
        return None
    if not callable(fn):
        raise ValueError("value must be None or a callable")
    if inspect.isbuiltin(fn):
        return lambda event: fn()
    try:
        inspect.getcallargs(fn)
        return lambda event: fn()
    except TypeError:
        try:
            inspect.getcallargs(fn, ())
            return fn
        except TypeError:
            raise ValueError("value must be a callable which accepts up to one mandatory parameter")


class SenseStick(object):
    """sense.stick: the joystick. Pushed on the page's panel, or with the
    arrow keys and Enter while the panel has the keyboard."""

    def __init__(self):
        self._buffer = []
        self._callbacks = {}
        self._closed = False
        _turns.after_turn(self._poll)

    def _poll(self):
        """Take the page's new events: keep them for get_events, and run the
        callbacks, one event at a time, in order."""
        if self._closed:
            return
        text = str(_turns.pi().senseEvents())
        for t, d, a in json.loads(text) if text else []:
            event = InputEvent(float(t), str(d), str(a))
            self._buffer.append(event)
            for f in (self._callbacks.get(event.direction), self._callbacks.get(DIRECTION_ANY)):
                if f is not None:
                    f(event)

    def _fetch(self):
        _turns.breathe(force=True)
        self._poll()

    def get_events(self):
        """Every joystick event since the last call (or since the program
        started), oldest first; [] when there have been none."""
        self._fetch()
        events, self._buffer = self._buffer, []
        return events

    def wait_for_event(self, emptybuffer=False):
        """Wait for the next joystick event and return it."""
        self._fetch()
        if emptybuffer:
            self._buffer = []
        _turns.wait_until(lambda: bool(self._buffer))
        return self._buffer.pop(0) if self._buffer else None

    def close(self):
        self._closed = True
        _turns.keep_alive(self, False)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _setter(direction):
        def get(self):
            return self._callbacks.get(direction)

        def put(self, fn):
            wrapped = _wrap_callback(fn)
            if wrapped is None:
                self._callbacks.pop(direction, None)
            else:
                self._callbacks[direction] = wrapped
            # A program whose last line set a callback keeps running, as it
            # does in Thonny (gpiozero's when_pressed does the same).
            _turns.keep_alive(self, bool(self._callbacks))
        return property(get, put)

    direction_up = _setter(DIRECTION_UP)
    direction_down = _setter(DIRECTION_DOWN)
    direction_left = _setter(DIRECTION_LEFT)
    direction_right = _setter(DIRECTION_RIGHT)
    direction_middle = _setter(DIRECTION_MIDDLE)
    direction_any = _setter(DIRECTION_ANY)
    del _setter


# ------------------------------------------------------------- the board
class SenseHat(object):
    def __init__(self, imu_settings_file="RTIMULib", text_assets="sense_hat_text"):
        self._rotation = 0
        self._stick = SenseStick()
        self._last_orientation = None
        self._imu = {"compass": True, "gyro": True, "accel": True}
        _framebuffer()
        _turns.breathe()

    # ---- the LEDs
    @property
    def stick(self):
        return self._stick

    @property
    def rotation(self):
        return self._rotation

    @rotation.setter
    def rotation(self, r):
        self.set_rotation(r, True)

    def set_rotation(self, r=0, redraw=True):
        if r not in _MAP:
            raise ValueError("Rotation must be 0, 90, 180 or 270 degrees")
        pixels = self.get_pixels() if redraw else None
        self._rotation = r
        if redraw:
            self.set_pixels(pixels)

    def flip_h(self, redraw=True):
        pixels = self.get_pixels()
        flipped = []
        for y in range(8):
            flipped.extend(reversed(pixels[y * 8:y * 8 + 8]))
        if redraw:
            self.set_pixels(flipped)
        return flipped

    def flip_v(self, redraw=True):
        pixels = self.get_pixels()
        flipped = []
        for y in reversed(range(8)):
            flipped.extend(pixels[y * 8:y * 8 + 8])
        if redraw:
            self.set_pixels(flipped)
        return flipped

    def set_pixels(self, pixel_list):
        if len(pixel_list) != 64:
            raise ValueError("Pixel lists must have 64 elements")
        fb = _framebuffer()
        m = _MAP[self._rotation]
        checked = [_check_pixel(p, i) for i, p in enumerate(pixel_list)]
        for i, pixel in enumerate(checked):
            fb[m[i // 8][i % 8]] = _pack(pixel)
        _show()

    def get_pixels(self):
        fb = _framebuffer()
        m = _MAP[self._rotation]
        _turns.breathe()
        return [_unpack(fb[m[y][x]]) for y in range(8) for x in range(8)]

    def set_pixel(self, x, y, *args):
        if len(args) == 1:
            pixel = args[0]
        elif len(args) == 3:
            pixel = args
        else:
            raise ValueError("Pixel arguments must be given as (r, g, b) or r, g, b")
        if x > 7 or x < 0:
            raise ValueError("X position must be between 0 and 7")
        if y > 7 or y < 0:
            raise ValueError("Y position must be between 0 and 7")
        pixel = _check_pixel(pixel)
        _framebuffer()[_MAP[self._rotation][y][x]] = _pack(pixel)
        _show()

    def get_pixel(self, x, y):
        if x > 7 or x < 0:
            raise ValueError("X position must be between 0 and 7")
        if y > 7 or y < 0:
            raise ValueError("Y position must be between 0 and 7")
        _turns.breathe()
        return _unpack(_framebuffer()[_MAP[self._rotation][y][x]])

    def clear(self, *args):
        black = (0, 0, 0)
        if len(args) == 0:
            colour = black
        elif len(args) == 1:
            colour = args[0]
        elif len(args) == 3:
            colour = args
        else:
            raise ValueError("Pixel arguments must be given as (r, g, b) or r, g, b")
        self.set_pixels([colour] * 64)

    def load_image(self, file_path, redraw=True):
        raise NotImplementedError("load_image isn't in PyIDE's Sense HAT: draw with set_pixels instead.")

    def _letter_pixels(self, ch, text_colour, back_colour):
        """A letter as 8 columns: one blank, its five, two blank (show_letter's
        layout on the real board)."""
        cols = [[False] * 8] + _glyph(ch) + [[False] * 8, [False] * 8]
        return [[text_colour if cols[x][y] else back_colour for x in range(8)] for y in range(8)]

    def show_letter(self, s, text_colour=[255, 255, 255], back_colour=[0, 0, 0]):
        if len(s) > 1:
            raise ValueError("Only one character may be passed into this method")
        text_colour = _check_pixel(text_colour)
        back_colour = _check_pixel(back_colour)
        rows = self._letter_pixels(s, text_colour, back_colour)
        self.set_pixels([p for row in rows for p in row])

    def show_message(self, text_string, scroll_speed=.1, text_colour=[255, 255, 255],
                     back_colour=[0, 0, 0]):
        """Scroll the text from right to left, one column every scroll_speed
        seconds; the program waits until it has gone by, as on the Pi."""
        text_colour = _check_pixel(text_colour)
        back_colour = _check_pixel(back_colour)
        columns = [[back_colour] * 8 for _ in range(8)]       # starts off the right edge
        for ch in str(text_string):
            for col in _glyph(ch):
                columns.append([text_colour if on else back_colour for on in col])
            columns.append([back_colour] * 8)
        columns.extend([back_colour] * 8 for _ in range(8))  # and ends off the left
        for start in range(len(columns) - 7):
            window = columns[start:start + 8]
            self.set_pixels([window[x][y] for y in range(8) for x in range(8)])
            _turns.sleep(scroll_speed)

    @property
    def low_light(self):
        return bool(_turns.pi().senseLowLight(-1))

    @low_light.setter
    def low_light(self, value):
        _turns.pi().senseLowLight(1 if value else 0)
        _turns.breathe()

    @property
    def gamma(self):
        return [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 17, 18, 20,
                21, 23, 25, 27, 29, 31]

    def gamma_reset(self):
        self.low_light = False

    # ---- the sensors (the panel's sliders)
    def _read(self):
        _turns.breathe()
        return json.loads(str(_turns.pi().senseRead()))

    def get_humidity(self):
        return float(self._read()["humidity"])

    @property
    def humidity(self):
        return self.get_humidity()

    def get_temperature_from_humidity(self):
        return float(self._read()["temperature"])

    def get_temperature_from_pressure(self):
        return float(self._read()["temperature"])

    def get_temperature(self):
        return self.get_temperature_from_humidity()

    @property
    def temp(self):
        return self.get_temperature_from_humidity()

    @property
    def temperature(self):
        return self.get_temperature_from_humidity()

    def get_pressure(self):
        return float(self._read()["pressure"])

    @property
    def pressure(self):
        return self.get_pressure()

    # ---- the IMU (pitch, roll and yaw sliders)
    def set_imu_config(self, compass_enabled, gyro_enabled, accel_enabled):
        for value in (compass_enabled, gyro_enabled, accel_enabled):
            if not isinstance(value, bool):
                raise TypeError("All set_imu_config parameters must be of boolean type")
        self._imu = {"compass": compass_enabled, "gyro": gyro_enabled, "accel": accel_enabled}

    def get_orientation_degrees(self):
        r = self._read()
        return {"pitch": float(r["pitch"]) % 360, "roll": float(r["roll"]) % 360,
                "yaw": float(r["yaw"]) % 360}

    def get_orientation_radians(self):
        d = self.get_orientation_degrees()
        return {k: math.radians(v if v <= 180 else v - 360) for k, v in d.items()}

    def get_orientation(self):
        return self.get_orientation_degrees()

    @property
    def orientation(self):
        return self.get_orientation_degrees()

    @property
    def orientation_radians(self):
        return self.get_orientation_radians()

    def get_compass(self):
        """Degrees from north: the yaw slider."""
        return self.get_orientation_degrees()["yaw"]

    @property
    def compass(self):
        return self.get_compass()

    def get_compass_raw(self):
        """The magnetic field in microteslas, from the yaw: a field of about
        50 uT pointing north along the board."""
        yaw = math.radians(self.get_compass())
        return {"x": 50 * math.cos(yaw), "y": -50 * math.sin(yaw), "z": 0.0}

    @property
    def compass_raw(self):
        return self.get_compass_raw()

    def get_gyroscope(self):
        return self.get_orientation_degrees()

    @property
    def gyro(self):
        return self.get_gyroscope()

    @property
    def gyroscope(self):
        return self.get_gyroscope()

    def get_gyroscope_raw(self):
        """How fast the board is turning, in radians a second: how far the
        sliders moved since the last reading."""
        now = time.monotonic()
        o = self.get_orientation_radians()
        last, self._last_orientation = self._last_orientation, (now, o)
        if last is None or now - last[0] <= 0:
            return {"x": 0.0, "y": 0.0, "z": 0.0}
        dt = now - last[0]

        def turn(k):
            d = o[k] - last[1][k]
            d = (d + math.pi) % (2 * math.pi) - math.pi
            return d / dt
        return {"x": turn("roll"), "y": turn("pitch"), "z": turn("yaw")}

    @property
    def gyro_raw(self):
        return self.get_gyroscope_raw()

    @property
    def gyroscope_raw(self):
        return self.get_gyroscope_raw()

    def get_accelerometer(self):
        return self.get_orientation_degrees()

    @property
    def accel(self):
        return self.get_accelerometer()

    @property
    def accelerometer(self):
        return self.get_accelerometer()

    def get_accelerometer_raw(self):
        """Gravity, in g, as the board feels it: flat is z = 1; tilting it
        moves gravity onto x (pitch) and y (roll)."""
        o = self.get_orientation_radians()
        p, r = o["pitch"], o["roll"]
        return {"x": -math.sin(p), "y": math.sin(r) * math.cos(p), "z": math.cos(r) * math.cos(p)}

    @property
    def accel_raw(self):
        return self.get_accelerometer_raw()

    @property
    def accelerometer_raw(self):
        return self.get_accelerometer_raw()
