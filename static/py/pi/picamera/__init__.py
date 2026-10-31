"""picamera for PyIDE's simulated Raspberry Pi.

The calls are the real library's (picamera 1.13, what Raspbian Jessie has,
and what chapter 8 of the Beginner's Guide teaches), so a program written
here runs on a classroom Pi with a Camera Module unchanged. The camera is
the computer's webcam, asked for when the program first starts the preview
or takes a picture, or a drawn test scene where there is none
(static/pi_camera.js).

Pictures are real files: capture('photo.jpg') writes a JPEG into the
program's folder, which the program can open again. They are not project
files (a project holds text), so the camera panel keeps them for the
session, each with a Download, and plays them as a flipbook — the book's
stop-motion film without avconv.

Settings are checked as the real library checks them, with its errors:
brightness 0-100, contrast -100 to 100, an image_effect from IMAGE_EFFECTS,
and so on. A rotation that isn't a multiple of 90 is rounded down to one,
as picamera does.
"""
import base64
import collections
import json
import os
import sys

import _pyide_pi as _turns

__all__ = ["PiCamera", "Color", "PiResolution", "PiCameraError", "PiCameraValueError",
           "PiCameraRuntimeError", "PiCameraClosed", "PiCameraNotRecording",
           "PiCameraAlreadyRecording", "PiCameraMMALError"]


class PiCameraError(Exception):
    pass


class PiCameraValueError(PiCameraError, ValueError):
    pass


class PiCameraRuntimeError(PiCameraError, RuntimeError):
    pass


class PiCameraClosed(PiCameraRuntimeError):
    pass


class PiCameraNotRecording(PiCameraRuntimeError):
    pass


class PiCameraAlreadyRecording(PiCameraRuntimeError):
    pass


class PiCameraMMALError(PiCameraError):
    pass


PiResolution = collections.namedtuple("PiResolution", ("width", "height"))

# The Pi's own folders, so the book's capture('/home/pi/Desktop/image.jpg')
# works as written. A folder the book has you make (Desktop/animation) still
# has to be made, as on a Pi.
try:
    os.makedirs("/home/pi/Desktop", exist_ok=True)
except OSError:
    pass


_NAMED = {
    "black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0), "green": (0, 128, 0),
    "lime": (0, 255, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0), "cyan": (0, 255, 255),
    "magenta": (255, 0, 255), "orange": (255, 165, 0), "purple": (128, 0, 128),
    "pink": (255, 192, 203), "grey": (128, 128, 128), "gray": (128, 128, 128),
    "brown": (165, 42, 42), "navy": (0, 0, 128),
}


class Color(object):
    """picamera's Color: Color('blue'), Color('#ff0000'), Color(255, 0, 0),
    or Color(1.0, 0, 0)."""

    def __init__(self, *args):
        if len(args) == 1 and isinstance(args[0], str):
            text = args[0].strip().lower()
            if text in _NAMED:
                rgb = _NAMED[text]
            elif text.startswith("#") and len(text) in (4, 7):
                h = text[1:]
                if len(h) == 3:
                    h = "".join(c * 2 for c in h)
                try:
                    rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
                except ValueError:
                    raise ValueError("Unrecognized color format %r" % args[0])
            else:
                raise ValueError("Unrecognized color format %r" % args[0])
        elif len(args) == 1 and isinstance(args[0], (tuple, list)):
            return self.__init__(*args[0])
        elif len(args) == 3:
            if all(isinstance(v, float) for v in args):
                rgb = tuple(int(round(v * 255)) for v in args)
            else:
                rgb = tuple(int(v) for v in args)
        else:
            raise ValueError("Unable to construct Color from %r" % (args,))
        if any(v < 0 or v > 255 for v in rgb):
            raise ValueError("Color components must be between 0 and 255 (or 0.0 and 1.0)")
        self.rgb_bytes = rgb
        self.red, self.green, self.blue = (v / 255.0 for v in rgb)

    @property
    def html(self):
        return "#%02x%02x%02x" % self.rgb_bytes

    def __eq__(self, other):
        return isinstance(other, Color) and other.rgb_bytes == self.rgb_bytes

    def __repr__(self):
        return "<Color html=%r>" % self.html


def _cam():
    return _turns.pi().camera


def _format_of(name, format):
    if format:
        f = str(format).lower()
    else:
        ext = os.path.splitext(str(name))[1].lower().lstrip(".")
        f = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "bmp": "bmp",
             "h264": "h264", "264": "h264", "mjpeg": "mjpeg", "mjpg": "mjpeg", "webm": "h264"}.get(ext)
        if f is None:
            raise PiCameraValueError("Unable to determine type from filename %s" % name)
    return f


_open = [None]       # the PiCamera in use: a Pi has one camera


def _ranged(name, low, high):
    def get(self):
        return self._s[name]

    def put(self, value):
        self._check_open()
        try:
            v = int(value)
        except (TypeError, ValueError):
            raise PiCameraValueError("Invalid %s value: %s" % (name, value))
        if not (low <= v <= high):
            raise PiCameraValueError("Invalid %s value: %d (valid range %d-%d)" % (name, v, low, high))
        self._s[name] = v
        self._push()
    return property(get, put)


def _choice(name, choices, words):
    def get(self):
        return self._s[name]

    def put(self, value):
        self._check_open()
        if value not in choices:
            raise PiCameraValueError("Invalid %s: %s" % (words, value))
        self._s[name] = value
        self._push()
    return property(get, put)


def _flag(name):
    def get(self):
        return self._s[name]

    def put(self, value):
        self._check_open()
        self._s[name] = bool(value)
        self._push()
    return property(get, put)


class PiCamera(object):
    IMAGE_EFFECTS = dict((k, i) for i, k in enumerate((
        "none", "negative", "solarize", "sketch", "denoise", "emboss", "oilpaint", "hatch", "gpen",
        "pastel", "watercolor", "film", "blur", "saturation", "colorswap", "washedout", "posterise",
        "colorpoint", "colorbalance", "cartoon", "deinterlace1", "deinterlace2")))
    AWB_MODES = dict((k, i) for i, k in enumerate((
        "off", "auto", "sunlight", "cloudy", "shade", "tungsten", "fluorescent", "incandescent",
        "flash", "horizon")))
    EXPOSURE_MODES = dict((k, i) for i, k in enumerate((
        "off", "auto", "night", "nightpreview", "backlight", "spotlight", "sports", "snow", "beach",
        "verylong", "fixedfps", "antishake", "fireworks")))
    METER_MODES = dict((k, i) for i, k in enumerate(("average", "spot", "backlit", "matrix")))
    DRC_STRENGTHS = dict((k, i) for i, k in enumerate(("off", "low", "medium", "high")))

    def __init__(self, camera_num=0, stereo_mode="none", stereo_decimate=False, resolution=None,
                 framerate=None, sensor_mode=0, led_pin=None, clock_mode="reset", framerate_range=None):
        if _open[0] is not None and not _open[0].closed:
            raise PiCameraMMALError("Failed to enable connection: Out of resources")
        self._closed = False
        self._preview = None
        self._recording = None
        self._s = {
            "rotation": 0, "hflip": False, "vflip": False, "brightness": 50, "contrast": 0,
            "saturation": 0, "sharpness": 0, "iso": 0, "exposure_compensation": 0,
            "image_effect": "none", "awb_mode": "auto", "exposure_mode": "auto",
            "meter_mode": "average", "drc_strength": "off", "annotate_text": "",
            "annotate_text_size": 32, "annotate_foreground": Color("white"),
            "annotate_background": None, "color_effects": None, "video_stabilization": False,
            "shutter_speed": 0, "crop": (0.0, 0.0, 1.0, 1.0), "framerate": 30,
        }
        self._resolution = PiResolution(1280, 720)
        if resolution is not None:
            self.resolution = resolution
        if framerate is not None:
            self.framerate = framerate
        _open[0] = self
        _turns.breathe()

    # ---- open and closed
    def _check_open(self):
        if self._closed:
            raise PiCameraClosed("Camera is closed")

    @property
    def closed(self):
        return self._closed

    def close(self):
        if self._closed:
            return
        if self._recording is not None:
            self.stop_recording()
        if self._preview is not None:
            self.stop_preview()
        self._closed = True
        if _open[0] is self:
            _open[0] = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---- what the page is told
    def _settings(self):
        s = dict((k, v) for k, v in self._s.items() if k not in ("annotate_foreground", "annotate_background"))
        s["annotate_foreground"] = self._s["annotate_foreground"].html
        bg = self._s["annotate_background"]
        s["annotate_background"] = bg.html if bg is not None else None
        return json.dumps(s, sort_keys=True)

    def _push(self):
        if self._preview is not None or self._recording is not None:
            _cam().settings(self._settings())

    # ---- the preview
    def start_preview(self, **options):
        self._check_open()
        self._preview = dict(options)
        _cam().preview(1, self._settings())
        _turns.breathe(force=True)
        return self

    def stop_preview(self):
        self._check_open()
        self._preview = None
        _cam().preview(0, self._settings())
        _turns.breathe(force=True)

    @property
    def preview(self):
        return self if self._preview is not None else None

    # ---- pictures
    def _size(self, resize):
        w, h = resize if resize else self._resolution
        return int(w), int(h)

    def capture(self, output, format=None, use_video_port=False, resize=None, splitter_port=0,
                bayer=False, **options):
        self._check_open()
        name = output if isinstance(output, str) else getattr(output, "name", "stream")
        fmt = _format_of(name, format) if isinstance(output, str) or format else "jpeg"
        if fmt not in ("jpeg", "png"):
            raise PiCameraValueError("PyIDE's camera takes .jpg and .png pictures, not %s" % fmt)
        # The first picture waits (a few seconds at most) for the webcam's
        # yes or no, or it would always be the test scene.
        _turns.wait_until(lambda: bool(_cam().ready()), timeout=5)
        w, h = self._size(resize)
        b64 = str(_cam().capture(self._settings(), w, h, fmt))
        data = base64.b64decode(b64)
        if isinstance(output, str):
            with open(output, "wb") as f:
                f.write(data)
        else:
            output.write(data)
        _cam().addPhoto(str(name), b64, fmt)
        _turns.breathe(force=True)

    def capture_continuous(self, output, format=None, use_video_port=False, resize=None, **options):
        """Picture after picture, named output.format(counter=n): the
        generator picamera has for time-lapses."""
        n = 0
        while True:
            n += 1
            name = output.format(counter=n, timestamp=None) if isinstance(output, str) else output
            self.capture(name, format, use_video_port, resize)
            yield name

    # ---- video
    def start_recording(self, output, format=None, resize=None, splitter_port=1, **options):
        self._check_open()
        if self._recording is not None:
            raise PiCameraAlreadyRecording("The camera is already using port %d" % splitter_port)
        name = output if isinstance(output, str) else getattr(output, "name", "stream")
        fmt = _format_of(name, format) if isinstance(output, str) or format else "h264"
        if fmt not in ("h264", "mjpeg"):
            raise PiCameraValueError("Invalid video format %s" % fmt)
        ok = int(_cam().record(1, str(name), self._settings()))
        self._recording = {"output": output, "name": name, "ok": ok}
        _turns.breathe(force=True)

    def wait_recording(self, timeout=0, splitter_port=1):
        if self._recording is None:
            raise PiCameraNotRecording("There is no recording in progress on port %d" % splitter_port)
        _turns.sleep(timeout)

    def stop_recording(self, splitter_port=1):
        self._check_open()
        if self._recording is None:
            raise PiCameraNotRecording("There is no recording in progress on port %d" % splitter_port)
        rec, self._recording = self._recording, None
        _cam().record(0, str(rec["name"]), self._settings())
        if not rec["ok"]:
            print("(This browser can't record video, so no video was saved.)", file=sys.stderr)
            return
        _turns.wait_until(lambda: _cam().recorded() is not None, timeout=5)
        b64 = _cam().recorded()
        data = base64.b64decode(str(b64)) if b64 else b""
        if isinstance(rec["output"], str):
            with open(rec["output"], "wb") as f:
                f.write(data)
        else:
            rec["output"].write(data)

    @property
    def recording(self):
        return self._recording is not None

    # ---- settings
    @property
    def resolution(self):
        return self._resolution

    @resolution.setter
    def resolution(self, value):
        self._check_open()
        if isinstance(value, str):
            named = {"VGA": (640, 480), "SVGA": (800, 600), "XGA": (1024, 768), "SXGA": (1280, 1024),
                     "UXGA": (1600, 1200), "HD": (1280, 720), "FHD": (1920, 1080), "1080P": (1920, 1080),
                     "720P": (1280, 720), "QVGA": (320, 240)}
            key = value.strip().upper()
            if key in named:
                value = named[key]
            else:
                try:
                    value = tuple(int(v) for v in key.split("X"))
                except ValueError:
                    raise PiCameraValueError("Invalid resolution: %s" % value)
        try:
            w, h = (int(v) for v in value)
        except (TypeError, ValueError):
            raise PiCameraValueError("Invalid resolution: %s" % (value,))
        if w <= 0 or h <= 0 or w > 3280 or h > 2464:
            raise PiCameraValueError("Invalid resolution: %dx%d (the camera's largest is 3280x2464)" % (w, h))
        self._resolution = PiResolution(w, h)

    @property
    def framerate(self):
        return self._s["framerate"]

    @framerate.setter
    def framerate(self, value):
        self._check_open()
        if not (0 < float(value) <= 90):
            raise PiCameraValueError("Invalid framerate: %s" % value)
        self._s["framerate"] = value

    @property
    def rotation(self):
        return self._s["rotation"]

    @rotation.setter
    def rotation(self, value):
        self._check_open()
        try:
            value = ((int(value) % 360) // 90) * 90
        except ValueError:
            raise PiCameraValueError("Invalid rotation angle: %s" % value)
        self._s["rotation"] = value
        self._push()

    hflip = _flag("hflip")
    vflip = _flag("vflip")
    video_stabilization = _flag("video_stabilization")
    brightness = _ranged("brightness", 0, 100)
    contrast = _ranged("contrast", -100, 100)
    saturation = _ranged("saturation", -100, 100)
    sharpness = _ranged("sharpness", -100, 100)
    exposure_compensation = _ranged("exposure_compensation", -25, 25)
    iso = _ranged("iso", 0, 1600)
    ISO = iso
    shutter_speed = _ranged("shutter_speed", 0, 6000000)
    image_effect = _choice("image_effect", IMAGE_EFFECTS, "image effect")
    awb_mode = _choice("awb_mode", AWB_MODES, "auto-white-balance mode")
    exposure_mode = _choice("exposure_mode", EXPOSURE_MODES, "exposure mode")
    meter_mode = _choice("meter_mode", METER_MODES, "metering mode")
    drc_strength = _choice("drc_strength", DRC_STRENGTHS, "dynamic range compression strength")

    @property
    def color_effects(self):
        return self._s["color_effects"]

    @color_effects.setter
    def color_effects(self, value):
        self._check_open()
        if value is not None:
            try:
                u, v = (int(x) for x in value)
            except (TypeError, ValueError):
                raise PiCameraValueError("Invalid color effects: %s" % (value,))
            if not (0 <= u <= 255 and 0 <= v <= 255):
                raise PiCameraValueError("Invalid color effects: (%d, %d)" % (u, v))
            value = (u, v)
        self._s["color_effects"] = value
        self._push()

    @property
    def crop(self):
        return self._s["crop"]

    @crop.setter
    def crop(self, value):
        self._check_open()
        self._s["crop"] = tuple(float(v) for v in value)

    zoom = crop

    @property
    def annotate_text(self):
        return self._s["annotate_text"]

    @annotate_text.setter
    def annotate_text(self, value):
        self._check_open()
        value = str(value)
        if len(value) > 255:
            raise PiCameraValueError("Invalid annotation text: %s (more than 255 characters)" % value)
        self._s["annotate_text"] = value
        self._push()

    @property
    def annotate_text_size(self):
        return self._s["annotate_text_size"]

    @annotate_text_size.setter
    def annotate_text_size(self, value):
        self._check_open()
        if not (6 <= int(value) <= 160):
            raise PiCameraValueError("Invalid annotation text size: %d (valid range 6-160)" % int(value))
        self._s["annotate_text_size"] = int(value)
        self._push()

    @property
    def annotate_foreground(self):
        return self._s["annotate_foreground"]

    @annotate_foreground.setter
    def annotate_foreground(self, value):
        self._check_open()
        if not isinstance(value, Color):
            raise PiCameraValueError("annotate_foreground must be a Color")
        self._s["annotate_foreground"] = value
        self._push()

    @property
    def annotate_background(self):
        return self._s["annotate_background"]

    @annotate_background.setter
    def annotate_background(self, value):
        self._check_open()
        if value is True:
            value = Color("black")
        elif value is False:
            value = None
        elif value is not None and not isinstance(value, Color):
            raise PiCameraValueError("annotate_background must be a Color or None")
        self._s["annotate_background"] = value
        self._push()

    @property
    def led(self):
        raise AttributeError("unreadable attribute")

    @led.setter
    def led(self, value):
        self._check_open()
