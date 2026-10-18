from krita import Krita
from .extension import AuvryntKritaExtension

Krita.instance().addExtension(AuvryntKritaExtension(Krita.instance()))
