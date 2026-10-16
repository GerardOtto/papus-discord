' Lanza scripts\run-bots.cmd sin ventana (lo usa la tarea "Papus Discord" al iniciar sesion).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = fso.GetParentFolderName(scriptDir)
sh.Run "cmd /c """ & scriptDir & "\run-bots.cmd""", 0, False
