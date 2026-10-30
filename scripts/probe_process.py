"""Bound disposable probe processes without disabling native permission controls."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path


def group_has_members(group: int) -> bool:
    """Observe numeric group membership, excluding only its retained zombie leader."""
    if sys.platform == "linux":
        for entry in Path("/proc").iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            except (FileNotFoundError, ProcessLookupError):
                continue
            if int(fields[2]) == group and (
                int(entry.name) != group or fields[0] not in {"Z", "X"}
            ):
                return True
        return False
    # Darwin supplies ps as an OS facility. Do not inherit command overrides or log names.
    observer = subprocess.Popen(
        ["/bin/ps", "-A", "-o", "pid=,pgid=,stat="],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
    )
    try:
        output, _errors = observer.communicate(timeout=1)
    except subprocess.TimeoutExpired:
        observer.kill()
        observer.communicate(timeout=1)
        raise OSError("Native process-group observation timed out.") from None
    if observer.returncode != 0:
        raise OSError("Native process-group membership could not be observed.")
    remaining = False
    for line in output.splitlines():
        pid, pgid, state = line.split()
        if int(pgid) == group and (int(pid) != group or state[0] not in {"Z", "X"}):
            remaining = True
    return remaining


def _signal_anchored_group(group: int, sig: int) -> None:
    """Signal before reaping the leader; verify Darwin's zombie-only EPERM case."""
    try:
        os.killpg(group, sig)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Darwin rejects signals when only the retained zombie leader remains.
        # Observation must prove no other members; post-reap cessation is still checked.
        if sys.platform != "darwin" or group_has_members(group):
            raise


def run_owned(
    command: list[str] | str,
    cwd: Path,
    env: dict[str, str],
    timeout: float,
    grace: float,
    *,
    cancelled: Callable[[], bool] | None = None,
    output=None,
) -> dict:
    """Use a POSIX process group or a Windows kill-on-close job before probe execution."""
    if os.name == "nt":
        if cancelled is not None:
            raise OSError("Cooperative cancellation is supported only by the POSIX supervisor.")
        return _windows_job(command, cwd, env, timeout, grace, output=output)
    if not all(
        hasattr(os, name)
        for name in (
            "waitid",
            "WNOWAIT",
            "WEXITED",
            "WNOHANG",
            "P_PID",
            "CLD_EXITED",
            "CLD_KILLED",
            "CLD_DUMPED",
        )
    ):
        raise OSError("POSIX probe supervision requires non-reaping child-exit observation.")
    child = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=output,
        stderr=output,
        start_new_session=True,
    )
    timed_out = False
    interrupted = False
    identity_retained = True
    try:
        deadline = time.monotonic() + timeout
        while True:
            if cancelled is not None and cancelled():
                interrupted = True
                break
            status = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG)
            if status is not None and status.si_code in {
                os.CLD_EXITED,
                os.CLD_KILLED,
                os.CLD_DUMPED,
            }:
                break
            if time.monotonic() >= deadline:
                timed_out = True
                break
            time.sleep(0.01)
    except ChildProcessError:
        identity_retained = False
        raise OSError(
            "Probe leader identity was lost; process-group cleanup is unverified."
        ) from None
    finally:
        if identity_retained:
            # Retain the unreaped session leader until every numeric group signal is sent.
            # Reaping it earlier would permit its PID to become an unrelated process group.
            try:
                if timed_out or interrupted:
                    _signal_anchored_group(child.pid, signal.SIGTERM)
                deadline = time.monotonic() + grace
                while True:
                    remaining_before_cleanup = group_has_members(child.pid)
                    if not remaining_before_cleanup or time.monotonic() >= deadline:
                        break
                    time.sleep(0.01)
            finally:
                # Observation failure must not skip bounded cleanup of the anchored group.
                try:
                    _signal_anchored_group(child.pid, signal.SIGKILL)
                finally:
                    cleanup_deadline = time.monotonic() + grace
                    child.wait(timeout=grace)
            while True:
                try:
                    os.killpg(child.pid, 0)
                    remaining = True
                except ProcessLookupError:
                    remaining = False
                except PermissionError:
                    raise OSError("Native process-group cessation could not be verified.") from None
                if not remaining or time.monotonic() >= cleanup_deadline:
                    break
                time.sleep(0.01)
    return {
        "exit_code": child.returncode,
        "timed_out": timed_out,
        "contained_processes_remaining_at_exit": (remaining_before_cleanup or remaining)
        and not timed_out
        and not interrupted,
        "contained_processes_remaining_before_cleanup": remaining_before_cleanup,
        "contained_processes_remaining_after_cleanup": remaining,
        "full_tree_cessation": None,
        "containment": "posix-process-group",
        "leader_retained_until_group_signals": True,
        "group_sigkill_requested": True,
        **({"interrupted": interrupted} if cancelled is not None else {}),
    }


def _windows_job(command, cwd, env, timeout, grace, *, output=None):
    import ctypes as c
    from ctypes import wintypes as w

    class BasicLimits(c.Structure):
        _fields_ = [
            ("process_time", c.c_longlong),
            ("job_time", c.c_longlong),
            ("flags", w.DWORD),
            ("min_ws", c.c_size_t),
            ("max_ws", c.c_size_t),
            ("active_limit", w.DWORD),
            ("affinity", c.c_size_t),
            ("priority", w.DWORD),
            ("scheduling", w.DWORD),
        ]

    class IoCounters(c.Structure):
        _fields_ = [
            (name, c.c_ulonglong)
            for name in ("reads", "writes", "other", "read_bytes", "write_bytes", "other_bytes")
        ]

    class ExtendedLimits(c.Structure):
        _fields_ = [
            ("basic", BasicLimits),
            ("io", IoCounters),
            ("process_memory", c.c_size_t),
            ("job_memory", c.c_size_t),
            ("peak_process_memory", c.c_size_t),
            ("peak_job_memory", c.c_size_t),
        ]

    class Accounting(c.Structure):
        _fields_ = [
            ("user_time", c.c_longlong),
            ("kernel_time", c.c_longlong),
            ("period_user", c.c_longlong),
            ("period_kernel", c.c_longlong),
            ("faults", w.DWORD),
            ("total", w.DWORD),
            ("active", w.DWORD),
            ("terminated", w.DWORD),
        ]

    class ThreadEntry(c.Structure):
        _fields_ = [
            ("size", w.DWORD),
            ("usage", w.DWORD),
            ("thread_id", w.DWORD),
            ("process_id", w.DWORD),
            ("priority", w.LONG),
            ("delta", w.LONG),
            ("flags", w.DWORD),
        ]

    kernel = c.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([c.c_void_p, w.LPCWSTR], w.HANDLE),
        "SetInformationJobObject": ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL),
        "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
        "QueryInformationJobObject": ([w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL),
        "TerminateJobObject": ([w.HANDLE, w.UINT], w.BOOL),
        "CreateToolhelp32Snapshot": ([w.DWORD, w.DWORD], w.HANDLE),
        "Thread32First": ([w.HANDLE, c.POINTER(ThreadEntry)], w.BOOL),
        "Thread32Next": ([w.HANDLE, c.POINTER(ThreadEntry)], w.BOOL),
        "OpenThread": ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        "OpenProcess": ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        "ResumeThread": ([w.HANDLE], w.DWORD),
        "CloseHandle": ([w.HANDLE], w.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes, function.restype = arguments, result

    def check(value):
        if not value:
            raise OSError("Native probe job admission or observation failed.")
        return value

    job = check(kernel.CreateJobObjectW(None, None))
    child = None
    try:
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway permission.
        check(kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
        child = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=output,
            creationflags=0x4,  # CREATE_SUSPENDED: assign containment before any Electron code.
        )
        process = check(kernel.OpenProcess(0x101, False, child.pid))
        try:
            check(kernel.AssignProcessToJobObject(job, process))
        finally:
            kernel.CloseHandle(process)
        snapshot = kernel.CreateToolhelp32Snapshot(4, 0)
        if snapshot == c.c_void_p(-1).value:
            raise OSError("Cannot inspect the suspended probe's initial thread.")
        try:
            entry = ThreadEntry()
            entry.size = c.sizeof(entry)
            found = kernel.Thread32First(snapshot, c.byref(entry))
            resumed = False
            while found:
                if entry.process_id == child.pid:
                    thread = check(kernel.OpenThread(0x2, False, entry.thread_id))
                    try:
                        if kernel.ResumeThread(thread) != 1:
                            raise OSError("Unexpected probe thread suspension state.")
                        resumed = True
                        break
                    finally:
                        kernel.CloseHandle(thread)
                found = kernel.Thread32Next(snapshot, c.byref(entry))
            if not resumed:
                raise OSError("The suspended probe thread was not found.")
        finally:
            kernel.CloseHandle(snapshot)
        timed_out = False
        try:
            child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        accounting = Accounting()
        check(
            kernel.QueryInformationJobObject(
                job, 1, c.byref(accounting), c.sizeof(accounting), None
            )
        )
        deadline = time.monotonic() + (0 if timed_out else grace)
        while accounting.active and time.monotonic() < deadline:
            time.sleep(0.01)
            check(
                kernel.QueryInformationJobObject(
                    job, 1, c.byref(accounting), c.sizeof(accounting), None
                )
            )
        remaining = accounting.active > 0
        if remaining:
            check(kernel.TerminateJobObject(job, 1))
            deadline = time.monotonic() + grace
            while accounting.active and time.monotonic() < deadline:
                time.sleep(0.01)
                check(
                    kernel.QueryInformationJobObject(
                        job, 1, c.byref(accounting), c.sizeof(accounting), None
                    )
                )
            if accounting.active:
                raise OSError("Probe job cessation is uncertain.")
        child.wait(timeout=grace)
        return {
            "exit_code": child.returncode,
            "timed_out": timed_out,
            "contained_processes_remaining_at_exit": remaining and not timed_out,
            "full_tree_cessation": None,
            "job_processes_ceased": True,
            "containment": "windows-kill-on-close-job",
        }
    finally:
        # Closing the job kills assigned descendants even if the Python supervisor fails.
        kernel.CloseHandle(job)
        if child is not None:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=grace)
