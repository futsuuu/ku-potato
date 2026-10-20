{
  description = "Development environment for KU-POTATO";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.nix-vite-plus.url = "github:ryoppippi/nix-vite-plus";

  outputs = { nixpkgs, nix-vite-plus, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.go_1_27
            nix-vite-plus.packages.${pkgs.stdenv.hostPlatform.system}.vp
            pkgs.chromium
            pkgs.pkg-config
            pkgs.gtk3
            pkgs.webkitgtk_4_1
          ];

          WAILS_TAGS = "webkit2_41";
          FONTCONFIG_FILE = pkgs.makeFontsConf {
            fontDirectories = [
              pkgs.noto-fonts
              pkgs.noto-fonts-cjk-sans
              pkgs.noto-fonts-color-emoji
            ];
          };

          shellHook = ''
            # https://wails.io/docs/guides/nixos-font/
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
          '';
        };
      });
    };
}
