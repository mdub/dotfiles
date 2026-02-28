function vj --description "Pretty-print JSON/JSONL via jq and bat"
    if test (count $argv) -gt 0
        jq . $argv | bat -l json
    else
        jq . | bat -l json
    end
end
