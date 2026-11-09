use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::Ioctl::IOCTL_STORAGE_QUERY_PROPERTY;
use windows_sys::Win32::System::IO::DeviceIoControl;

use crate::models::DriveInfo;

const DRIVE_UNKNOWN: u32 = 0;
const DRIVE_NO_ROOT_DIR: u32 = 1;
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;
const DRIVE_CDROM: u32 = 5;
const DRIVE_RAMDISK: u32 = 6;

#[repr(C)]
struct StoragePropertyQuery {
    property_id: u32,
    query_type: u32,
    additional_parameters: [u8; 1],
}

#[repr(C)]
struct DeviceSeekPenaltyDescriptor {
    version: u32,
    size: u32,
    incurs_seek_penalty: u8,
}

fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn is_drive_ssd(drive_letter: char) -> Option<bool> {
    unsafe {
        let path = format!("\\\\.\\{}:", drive_letter);
        let wide_path = to_wide(&path);
        let handle = CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null_mut(),
            OPEN_EXISTING,
            0,
            INVALID_HANDLE_VALUE,
        );

        if handle == INVALID_HANDLE_VALUE {
            return None;
        }

        let query = StoragePropertyQuery {
            property_id: 7, // StorageDeviceSeekPenaltyProperty
            query_type: 0,  // PropertyStandardQuery
            additional_parameters: [0],
        };

        let mut descriptor = DeviceSeekPenaltyDescriptor {
            version: 0,
            size: 0,
            incurs_seek_penalty: 1,
        };

        let mut bytes_returned = 0u32;
        let success = DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            &query as *const _ as *const _,
            std::mem::size_of::<StoragePropertyQuery>() as u32,
            &mut descriptor as *mut _ as *mut _,
            std::mem::size_of::<DeviceSeekPenaltyDescriptor>() as u32,
            &mut bytes_returned,
            null_mut(),
        );

        CloseHandle(handle);

        if success != 0 {
            // incurs_seek_penalty == 0 means SSD, 1 means HDD
            Some(descriptor.incurs_seek_penalty == 0)
        } else {
            None
        }
    }
}

pub fn get_system_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();

    unsafe {
        let buffer_len = GetLogicalDriveStringsW(0, null_mut());
        if buffer_len == 0 {
            return drives;
        }

        let mut buffer: Vec<u16> = vec![0; buffer_len as usize];
        let copied = GetLogicalDriveStringsW(buffer_len, buffer.as_mut_ptr());
        if copied == 0 {
            return drives;
        }

        let mut current_offset = 0;
        while current_offset < buffer.len() {
            let slice = &buffer[current_offset..];
            let len = slice.iter().position(|&c| c == 0).unwrap_or(0);
            if len == 0 {
                break;
            }

            let drive_path_wide = &slice[..len];
            let mount_point = OsString::from_wide(drive_path_wide)
                .to_string_lossy()
                .to_string();

            current_offset += len + 1;

            let drive_type_raw = GetDriveTypeW(drive_path_wide.as_ptr());
            if drive_type_raw == DRIVE_UNKNOWN || drive_type_raw == DRIVE_NO_ROOT_DIR {
                continue;
            }

            let drive_letter = mount_point.chars().next().unwrap_or('C');

            let drive_type = match drive_type_raw {
                DRIVE_REMOVABLE => "Removable (USB)".to_string(),
                DRIVE_FIXED => match is_drive_ssd(drive_letter) {
                    Some(true) => "SSD".to_string(),
                    Some(false) => "HDD".to_string(),
                    None => "Fixed Disk".to_string(),
                },
                DRIVE_REMOTE => "Network".to_string(),
                DRIVE_CDROM => "CD/DVD Drive".to_string(),
                DRIVE_RAMDISK => "RAM Disk".to_string(),
                _ => "Unknown".to_string(),
            };

            let mut free_bytes_caller = 0u64;
            let mut total_bytes = 0u64;
            let mut total_free_bytes = 0u64;

            let ok = GetDiskFreeSpaceExW(
                drive_path_wide.as_ptr(),
                &mut free_bytes_caller,
                &mut total_bytes,
                &mut total_free_bytes,
            );

            if ok == 0 || total_bytes == 0 {
                continue;
            }

            let used_bytes = total_bytes.saturating_sub(free_bytes_caller);
            let usage_percentage = (used_bytes as f64 / total_bytes as f64) * 100.0;

            // Volume info: Volume name & File System name
            let mut vol_name_buf: [u16; 260] = [0; 260];
            let mut fs_name_buf: [u16; 260] = [0; 260];
            let mut serial_number = 0u32;
            let mut max_component_len = 0u32;
            let mut flags = 0u32;

            let vol_ok = GetVolumeInformationW(
                drive_path_wide.as_ptr(),
                vol_name_buf.as_mut_ptr(),
                vol_name_buf.len() as u32,
                &mut serial_number,
                &mut max_component_len,
                &mut flags,
                fs_name_buf.as_mut_ptr(),
                fs_name_buf.len() as u32,
            );

            let volume_name = if vol_ok != 0 {
                let end = vol_name_buf.iter().position(|&c| c == 0).unwrap_or(0);
                let name = OsString::from_wide(&vol_name_buf[..end])
                    .to_string_lossy()
                    .to_string();
                if name.trim().is_empty() {
                    format!("Local Disk ({}:)", drive_letter)
                } else {
                    name
                }
            } else {
                format!("Local Disk ({}:)", drive_letter)
            };

            let fs_type = if vol_ok != 0 {
                let end = fs_name_buf.iter().position(|&c| c == 0).unwrap_or(0);
                OsString::from_wide(&fs_name_buf[..end])
                    .to_string_lossy()
                    .to_string()
            } else {
                "NTFS".to_string()
            };

            // Warning threshold: Free space below 15% or below 15 GB
            let fifteen_gb = 15u64 * 1024 * 1024 * 1024;
            let is_low_space = free_bytes_caller < (total_bytes * 15 / 100)
                || free_bytes_caller < fifteen_gb;

            drives.push(DriveInfo {
                mount_point,
                volume_name,
                fs_type,
                total_bytes,
                available_bytes: free_bytes_caller,
                used_bytes,
                usage_percentage: (usage_percentage * 10.0).round() / 10.0,
                drive_type,
                is_low_space,
            });
        }
    }

    drives
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_system_drives() {
        let drives = get_system_drives();
        assert!(!drives.is_empty(), "Expected to detect at least one logical drive");

        for drive in &drives {
            assert!(!drive.mount_point.is_empty());
            assert!(drive.total_bytes > 0);
            assert!(drive.usage_percentage >= 0.0 && drive.usage_percentage <= 100.0);
            assert!(!drive.drive_type.is_empty());
        }
    }
}
