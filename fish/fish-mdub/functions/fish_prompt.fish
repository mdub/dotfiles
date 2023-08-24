# You can override some default options with config.fish:
#
#  set -g theme_short_path yes

function fish_prompt
  set -l last_command_status $status
  set -l cwd

  if test "$theme_short_path" = 'yes'
    set cwd (basename (prompt_pwd))
  else
    set cwd (prompt_pwd)
  end

  set -l fish     "⋊>"
  set -l ahead    "↑"
  set -l behind   "↓"
  set -l diverged "⥄ "
  set -l dirty    "⨯"
  set -l none     "◦"

  set -l normal_color     (set_color normal)
  set -l success_color    (set_color cyan)
  set -l error_color      (set_color red --bold)
  set -l directory_color  (set_color $fish_color_quote 2> /dev/null; or set_color brown)
  set -l env_color        (set_color 00afff)

  echo ""

  echo -n -s (date +%H:%M) " " $directory_color $cwd $normal_color

  if test -n "$HERMIT_ENV"
    echo -n $env_color 🐚 (basename "$HERMIT_ENV")
  end

  fish_git_prompt

  if test -n "$SQM_ENV"
    echo -n $normal_color "[$SQM_ENV/$SQM_REGION]"
  end

  echo ""

  if test $last_command_status -eq 0
    echo -n $success_color
  else
    echo -n $error_color
  end
  echo -n $fish $normal_color
end
