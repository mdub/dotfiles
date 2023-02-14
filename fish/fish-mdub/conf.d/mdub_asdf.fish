fish_add_path --path -g ~/.asdf/shims

if status is-interactive
  source (brew --prefix asdf)/libexec/lib/asdf.fish
end
