"""A point or a direction in the world: x across, y up, z the other way across."""
import math


class Vec3:
    def __init__(self, x=0, y=0, z=0):
        self.x = x
        self.y = y
        self.z = z

    def clone(self):
        return Vec3(self.x, self.y, self.z)

    def __iter__(self):
        return iter((self.x, self.y, self.z))

    def __add__(self, other):
        return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)

    def __sub__(self, other):
        return Vec3(self.x - other.x, self.y - other.y, self.z - other.z)

    def __mul__(self, k):
        return Vec3(self.x * k, self.y * k, self.z * k)

    __rmul__ = __mul__

    def __neg__(self):
        return Vec3(-self.x, -self.y, -self.z)

    def __iadd__(self, other):
        self.x += other.x
        self.y += other.y
        self.z += other.z
        return self

    def __isub__(self, other):
        self.x -= other.x
        self.y -= other.y
        self.z -= other.z
        return self

    def __imul__(self, k):
        self.x *= k
        self.y *= k
        self.z *= k
        return self

    def length(self):
        return math.sqrt(self.lengthSqr())

    def lengthSqr(self):
        return self.x * self.x + self.y * self.y + self.z * self.z

    def _key(self):
        return (self.x, self.y, self.z)

    def __eq__(self, other):
        return isinstance(other, Vec3) and self._key() == other._key()

    def __ne__(self, other):
        return not self == other

    def __lt__(self, other):
        return self._key() < other._key()

    def __le__(self, other):
        return self._key() <= other._key()

    def __gt__(self, other):
        return self._key() > other._key()

    def __ge__(self, other):
        return self._key() >= other._key()

    def __hash__(self):
        return hash(self._key())

    def rotateLeft(self):
        self.x, self.z = self.z, -self.x
        return self

    def rotateRight(self):
        self.x, self.z = -self.z, self.x
        return self

    def __repr__(self):
        return "Vec3(%s,%s,%s)" % (self.x, self.y, self.z)
