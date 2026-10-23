{pkgs}: {
  deps = [
    pkgs.ffmpeg
    pkgs.pkg-config
    pkgs.librsvg
    pkgs.giflib
    pkgs.libjpeg
    pkgs.libpng
    pkgs.pango
    pkgs.cairo
    pkgs.libuuid
    pkgs.postgresql
  ];
}
