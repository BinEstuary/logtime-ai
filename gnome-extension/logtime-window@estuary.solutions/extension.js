// Xuất một method D-Bus duy nhất trên session bus của GNOME Shell: trả về app + tiêu đề cửa sổ đang focus.
// GNOME Wayland không cho app thường đọc thông tin này, nên LogTime AI cần extension này để ghi nhận hoạt động.
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OBJECT_PATH = '/solutions/estuary/LogTime/Window';
const IFACE_XML = `
<node>
  <interface name="solutions.estuary.LogTime.Window">
    <method name="GetFocused">
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

export default class LogTimeWindowExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.flush();
        this._dbus?.unexport();
        this._dbus = null;
    }

    GetFocused() {
        const win = global.display.get_focus_window();
        if (!win)
            return '{}';
        return JSON.stringify({
            wm_class: win.get_wm_class() ?? '',
            title: win.get_title() ?? '',
        });
    }
}
