use tauri::State;

use crate::core::settings_store::SettingsStore;
use crate::models::settings::DevHubSettings;

const FALLBACK_FONTS: &[&str] = &["Inter", "Segoe UI", "JetBrains Mono", "Consolas"];
const FONT_STYLE_SUFFIXES: &[&str] = &[
    "Thin",
    "Extra Light",
    "ExtraLight",
    "Ultra Light",
    "UltraLight",
    "Light",
    "Regular",
    "Normal",
    "Medium",
    "Semi Bold",
    "SemiBold",
    "Demi Bold",
    "DemiBold",
    "Bold",
    "Extra Bold",
    "ExtraBold",
    "Ultra Bold",
    "UltraBold",
    "Black",
    "Heavy",
    "Italic",
    "Oblique",
    "Condensed",
    "Extended",
];

#[tauri::command]
pub async fn load_settings(
    settings_store: State<'_, SettingsStore>,
) -> Result<DevHubSettings, String> {
    settings_store
        .load_or_create()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_settings(
    settings_store: State<'_, SettingsStore>,
    settings: DevHubSettings,
) -> Result<(), String> {
    settings_store
        .save(&settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    Ok(read_system_fonts())
}

fn read_system_fonts() -> Vec<String> {
    let mut fonts = platform_system_fonts();
    fonts.extend(FALLBACK_FONTS.iter().map(|font| font.to_string()));
    fonts.sort_by_key(|font| font.to_lowercase());
    fonts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    fonts
}

#[cfg(target_os = "windows")]
fn platform_system_fonts() -> Vec<String> {
    let keys = [
        r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    ];

    keys.iter()
        .filter_map(|key| {
            std::process::Command::new("reg")
                .args(["query", key])
                .output()
                .ok()
        })
        .flat_map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter_map(|line| parse_windows_font_name(&line))
        .collect()
}

#[cfg(target_os = "windows")]
fn parse_windows_font_name(line: &str) -> Option<String> {
    let (name, _) = line.split_once("REG_")?;
    let family = name
        .trim()
        .split_once('(')
        .map_or_else(|| name.trim(), |(family, _)| family.trim());
    let family = strip_font_style_suffixes(family);

    (!family.is_empty()).then_some(family)
}

fn strip_font_style_suffixes(font_name: &str) -> String {
    let mut family = font_name.trim().to_string();

    loop {
        let family_lower = family.to_lowercase();
        let Some(next_family) = FONT_STYLE_SUFFIXES.iter().find_map(|suffix| {
            let suffix_lower = suffix.to_lowercase();
            family_lower
                .strip_suffix(&suffix_lower)
                .and_then(|candidate| {
                    let end = candidate.trim_end().len();
                    (end > 0).then_some(family[..end].trim().to_string())
                })
        }) else {
            break;
        };

        if next_family == family {
            break;
        }
        family = next_family;
    }

    family
}

#[cfg(not(target_os = "windows"))]
fn platform_system_fonts() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::parse_windows_font_name;

    #[test]
    fn parses_windows_font_registry_names_as_regular_font_families() {
        let fonts = [
            "    Arial (TrueType)    REG_SZ    arial.ttf",
            "    Arial Bold (TrueType)    REG_SZ    arialbd.ttf",
            "    JetBrains Mono Italic (TrueType)    REG_SZ    JetBrainsMono-Italic.ttf",
            "    Microsoft YaHei UI Light (TrueType)    REG_SZ    msyhl.ttc",
            "    Segoe UI Semibold (TrueType)    REG_SZ    seguisb.ttf",
        ]
        .into_iter()
        .filter_map(parse_windows_font_name)
        .collect::<Vec<_>>();

        assert_eq!(
            fonts,
            vec![
                "Arial",
                "Arial",
                "JetBrains Mono",
                "Microsoft YaHei UI",
                "Segoe UI"
            ]
        );
    }
}
