#### GWS.MEET.6.1v1
Administrators SHOULD NOT be allowed to override the default sharing level for meeting notes set by the organization.

[![Automated Check](https://img.shields.io/badge/Automated_Check-5E9732)](#key-terminology)
[![Log-Based Check](https://img.shields.io/badge/Log--Based_Check-F6E8E5)](../../docs/usage/Limitations.md#log-based-policy-checks)

- _Rationale:_ Meeting notes may contain sensitive information that should not be shared outside of the organization. Preventing administrators from overriding the default sharing level reduces the risk of inadvertent meeting note sharing.
- _Last modified:_ March 2026
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ AC-3, SC-7(10)
- MITRE ATT&CK TTP Mapping
  - [T1530: Data from Cloud Storage](https://attack.mitre.org/techniques/T1530/)
  - [T1567:002: Exfiltration Over Web Service: Exfiltration to Cloud Storage](https://attack.mitre.org/techniques/T1567/002/)

#### GWS.MEET.6.2v1
Default sharing setting for Google AI notes SHALL be restricted to "Guests in your organization."

[![Automated Check](https://img.shields.io/badge/Automated_Check-5E9732)](#key-terminology)
[![Log-Based Check](https://img.shields.io/badge/Log--Based_Check-F6E8E5)](../../docs/usage/Limitations.md#log-based-policy-checks)

- _Rationale:_ Meeting notes may contain sensitive information that should not be shared outside of the organization. Setting a secure default sharing level reduces the risk of inadvertent meeting note sharing.
- _Last modified:_ March 2026
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ SC-7(10)
- MITRE ATT&CK TTP Mapping
  - [T1530: Data from Cloud Storage](https://attack.mitre.org/techniques/T1530/)
  - [T1567:002: Exfiltration Over Web Service: Exfiltration to Cloud Storage](https://attack.mitre.org/techniques/T1567/002/)

#### GWS.MEET.6.3v1
Screenshots of presented content SHALL only captured in notes when recording is enabled.

[![Manual](https://img.shields.io/badge/Manual-046B9A)](#gwscommoncontrols83v06-instructions)

- _Rationale:_ Screenshots of presented content may contain sensitive information. Restricting screenshot capture to meetings where recording is enabled helps ensure visual content is only retained when the meeting host has intentionally elected to record the meeting.

- _Last modified:_ August 2026
- _Note:_ Entities are responsible to comply with applicable records retention, management requirements, and FOIA request for meeting recordings.
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ AC-3, SC-7(10)
- MITRE ATT&CK TTP Mapping
  - [T1113: Screen Capture](https://attack.mitre.org/techniques/T1113/)
  - [T1530: Data from Cloud Storage](https://attack.mitre.org/techniques/T1530/)
  - [T1567:002: Exfiltration Over Web Service: Exfiltration to Cloud Storage](https://attack.mitre.org/techniques/T1567/002/)

### Resources
- [Take notes for me in Google Meet](https://support.google.com/meet/answer/14754931)

### Prerequisites
-   None

### Implementation

#### GWS.MEET.6.1v1 Instructions
1.  Sign in to the [Google Admin Console](https://admin.google.com).
2.  Select **Menu** -> **Apps** -> **Google Workspace** -> **Google Meet**.
3.  Click **Gemini Settings**.
4.  Click **Gemini notes sharing**.
5.  Ensure **Allow hosts to change who notes are shared to** is unselected.
6.  Click **Save**.

#### GWS.MEET.6.2v1 Instructions
1.  Sign in to the [Google Admin Console](https://admin.google.com).
2.  Select **Menu** -> **Apps** -> **Google Workspace** -> **Google Meet**.
3.  Click **Gemini Settings**.
4.  Click **Gemini notes sharing**.
5.  Ensure **Default sharing setting for Gemini notes** is set to "The hosts and co-hosts" or "Invited guests in your organization".
6.  Click **Save**.

#### GWS.MEET.6.3v1 Instructions
1.  Sign in to the [Google Admin Console](https://admin.google.com).
2.  Select **Menu** -> **Apps** -> **Google Workspace** -> **Google Meet**.
3.  Click **Gemini Settings**.
4.  Click **Visual content in notes**.
5.  Ensure **Select when the visual notes feature is enabled** is set to "Only allow screenshots of presented content to be captured in notes when recording is enabled".
6.  Click **Save**.
