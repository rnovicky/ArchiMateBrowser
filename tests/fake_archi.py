"""
A stand-in for Archi's command line, for the tests (the API's BL-42).

The test server gives it to the API as ARCHI_PATH (through a small .cmd that
runs it with this Python). Its ".archimate" files hold exchange XML, so a
conversion is a copy:

    --loadModel SRC --xmlexchange.export DST    copies SRC to DST
    --xmlexchange.import SRC --saveModel DST    copies SRC to DST
"""

import shutil
import sys


def main(args: list[str]) -> int:
    def value(flag: str) -> str | None:
        return args[args.index(flag) + 1] if flag in args else None

    source = value("--loadModel") or value("--xmlexchange.import")
    target = value("--xmlexchange.export") or value("--saveModel")
    if not source or not target:
        print("fake Archi: nothing to do", file=sys.stderr)
        return 1
    shutil.copyfile(source, target)
    print(f"fake Archi: {source} -> {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
