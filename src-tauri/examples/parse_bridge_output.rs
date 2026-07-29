use app_network_debugger_lib::event_parser::parse_event_line;
use std::io::{self, BufRead};

fn main() -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        match parse_event_line(&line?) {
            Ok(Some(event)) => {
                println!("{} {}", event.kind(), event.flow_id());
            }
            Ok(None) => {}
            Err(error) => eprintln!("{error}"),
        }
    }

    Ok(())
}
