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
            pkgs.protobuf
            pkgs.llvmPackages_18.clang-tools
            nix-vite-plus.packages.${pkgs.stdenv.hostPlatform.system}.vp
            pkgs.chromium
            pkgs.pkg-config
            pkgs.gtk4
            pkgs.webkitgtk_6_0
          ];

          FONTCONFIG_FILE = pkgs.makeFontsConf {
            fontDirectories = [
              pkgs.noto-fonts
              pkgs.noto-fonts-cjk-sans
              pkgs.noto-fonts-color-emoji
            ];
          };

          shellHook = ''
            export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH:$XDG_DATA_DIRS"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
          '';
        };
      });
    };
}
