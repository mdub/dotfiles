# from https://github.com/fish-shell/fish-shell/issues/11123

function __aws_completer
		set -lx COMP_LINE (commandline -pc)
		set -lx COMP_POINT (string length $COMP_LINE)
		aws_completer | tr -d ' '
	end

complete -c aws -f -a "(__aws_completer)"
