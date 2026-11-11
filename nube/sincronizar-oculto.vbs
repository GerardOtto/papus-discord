' Copia al servidor los datos del motor y las carpetas de entrega, sin ventana (tarea "Papus Nube Sincronizar",
' solo mientras los bots estan en la nube). Registro: data\nube-sincronizar.log
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "cmd /c node --disable-warning=ExperimentalWarning --import tsx nube\nube.ts sincronizar >> data\nube-sincronizar.log 2>&1", 0, False
