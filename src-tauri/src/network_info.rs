use if_addrs::{IfAddr, get_if_addrs};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanAddress {
    pub interface_name: String,
    pub address: String,
    pub prefix_length: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub recommended_address: Option<String>,
    pub addresses: Vec<LanAddress>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Candidate {
    interface_name: String,
    address: Ipv4Addr,
    prefix_length: u8,
}

#[tauri::command]
pub fn get_network_info() -> Result<NetworkInfo, String> {
    let interfaces =
        get_if_addrs().map_err(|error| format!("Cannot scan network interfaces: {error}"))?;
    let routed_address = detect_routed_ipv4();
    let mut seen = HashSet::new();
    let mut candidates = interfaces
        .into_iter()
        .filter(|interface| interface.is_oper_up())
        .filter_map(|interface| {
            let IfAddr::V4(address) = interface.addr else {
                return None;
            };
            if !is_usable_lan_address(address.ip) || !seen.insert(address.ip) {
                return None;
            }
            Some(Candidate {
                interface_name: interface.name,
                address: address.ip,
                prefix_length: address.prefixlen,
            })
        })
        .collect::<Vec<_>>();

    sort_candidates(&mut candidates, routed_address);
    let recommended_address = candidates.first().map(|entry| entry.address.to_string());
    let addresses = candidates
        .into_iter()
        .map(|entry| LanAddress {
            interface_name: entry.interface_name,
            address: entry.address.to_string(),
            prefix_length: entry.prefix_length,
        })
        .collect();

    Ok(NetworkInfo {
        recommended_address,
        addresses,
    })
}

fn detect_routed_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(1, 1, 1, 1), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) if is_usable_lan_address(address) => Some(address),
        _ => None,
    }
}

fn sort_candidates(candidates: &mut [Candidate], routed_address: Option<Ipv4Addr>) {
    candidates.sort_by(|left, right| {
        candidate_sort_key(left, routed_address)
            .cmp(&candidate_sort_key(right, routed_address))
            .then_with(|| compare_ipv4(left.address, right.address))
    });
}

fn candidate_sort_key(
    candidate: &Candidate,
    routed_address: Option<Ipv4Addr>,
) -> (bool, bool, u8, bool) {
    (
        is_likely_virtual_interface(&candidate.interface_name),
        Some(candidate.address) != routed_address,
        physical_interface_priority(&candidate.interface_name),
        !candidate.address.is_private(),
    )
}

fn compare_ipv4(left: Ipv4Addr, right: Ipv4Addr) -> Ordering {
    u32::from(left).cmp(&u32::from(right))
}

fn physical_interface_priority(name: &str) -> u8 {
    let normalized = name.to_ascii_lowercase();
    if normalized.contains("wi-fi")
        || normalized.contains("wifi")
        || normalized.contains("wlan")
        || normalized.contains("wireless")
    {
        0
    } else if normalized.contains("ethernet") || normalized.contains("lan") {
        1
    } else {
        2
    }
}

fn is_likely_virtual_interface(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    [
        "virtual",
        "vethernet",
        "hyper-v",
        "docker",
        "wsl",
        "vpn",
        "tunnel",
        "tailscale",
        "zerotier",
        "loopback",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn is_usable_lan_address(address: Ipv4Addr) -> bool {
    !address.is_loopback()
        && !address.is_link_local()
        && !address.is_unspecified()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
}

#[cfg(test)]
mod tests {
    use super::{Candidate, is_usable_lan_address, sort_candidates};
    use std::net::Ipv4Addr;

    fn candidate(name: &str, address: [u8; 4]) -> Candidate {
        Candidate {
            interface_name: name.to_owned(),
            address: Ipv4Addr::from(address),
            prefix_length: 24,
        }
    }

    #[test]
    fn rejects_addresses_that_cannot_be_used_by_a_phone() {
        assert!(!is_usable_lan_address(Ipv4Addr::LOCALHOST));
        assert!(!is_usable_lan_address(Ipv4Addr::new(169, 254, 10, 20)));
        assert!(!is_usable_lan_address(Ipv4Addr::UNSPECIFIED));
        assert!(!is_usable_lan_address(Ipv4Addr::BROADCAST));
        assert!(is_usable_lan_address(Ipv4Addr::new(192, 168, 1, 18)));
    }

    #[test]
    fn selects_the_routed_physical_interface() {
        let routed = Ipv4Addr::new(172, 16, 16, 111);
        let mut candidates = vec![
            candidate("Ethernet", [192, 168, 1, 10]),
            candidate("Wi-Fi", [172, 16, 16, 111]),
            candidate("vEthernet (WSL)", [172, 20, 0, 1]),
        ];

        sort_candidates(&mut candidates, Some(routed));

        assert_eq!(candidates[0].address, routed);
        assert_eq!(candidates[1].interface_name, "Ethernet");
        assert_eq!(candidates[2].interface_name, "vEthernet (WSL)");
    }

    #[test]
    fn prefers_wifi_when_default_route_is_unavailable() {
        let mut candidates = vec![
            candidate("Ethernet 2", [192, 168, 10, 2]),
            candidate("Wi-Fi", [192, 168, 20, 2]),
        ];

        sort_candidates(&mut candidates, None);

        assert_eq!(candidates[0].interface_name, "Wi-Fi");
    }
}
